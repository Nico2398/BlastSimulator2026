// BlastSimulator2026 — Shared shuttle rides (#2290)
// Several employees setting off for far work from near a parked shuttle ride it
// together: one drives, the others sit in its passenger seats. This module holds the
// pieces both the planner (PlanItinerary.ts) and the locomotion tick (Locomotion.ts)
// share — who is about to drive a shuttle, how many seats are spoken for, the short
// bounded wait the driver holds for boarders, and the passengers' carried position.
// It reads itineraries and never plans one, so the planner may import it freely.

import type { GameState } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';
import type { Vehicle } from '../entities/Vehicle.js';
import { vehicleDriverId, vehiclePassengerIds, vehicleSeatCount } from '../entities/Vehicle.js';
import { TRAVEL_BOARDING_WAIT_TICKS } from '../config/balance.js';
import type { Itinerary, Leg } from './Itinerary.js';

/** A driver about to set off in a travel vehicle that a passenger could still join. */
interface ShuttleHost {
  driver: Employee;
  vehicle: Vehicle;
  /** The drive leg that carries the ride, whose destination every passenger is dropped at. */
  driveLeg: Leg;
  /** Ticks until the driver is aboard (0 once they are). */
  boardTicks: number;
  /** Ticks the shuttle still waits for boarders once its driver is aboard. */
  holdTicks: number;
}

/** True for a board leg onto the passenger seat of `vehicleId`. */
function isPassengerBoardFor(leg: Leg | undefined, vehicleId: number): boolean {
  return leg !== undefined && leg.onArrive.kind === 'board' && leg.onArrive.passenger === true && leg.onArrive.vehicleId === vehicleId;
}

/** Employees (other than `exceptId`) on their way to a passenger seat of `vehicleId`. */
function committedPassengers(state: GameState, vehicleId: number, exceptId: number): number {
  let count = 0;
  for (const e of state.employees.employees) {
    if (e.alive && e.id !== exceptId && isPassengerBoardFor(e.itinerary?.legs[0], vehicleId)) count++;
  }
  return count;
}

/** True while some employee is still walking to a passenger seat of `vehicleId`. */
function hasBoardingPassengers(state: GameState, vehicleId: number): boolean {
  return committedPassengers(state, vehicleId, -1) > 0;
}

/**
 * The drivers `passenger` could ride with: a travel vehicle whose driver has an itinerary
 * that is still on its board leg or its boarding hold — not yet driving away — with a drive
 * leg that alights, and a seat left once the passengers already on their way are counted.
 */
export function findShuttleHosts(state: GameState, passenger: Employee): ShuttleHost[] {
  const hosts: ShuttleHost[] = [];
  for (const driver of state.employees.employees) {
    if (!driver.alive || driver.id === passenger.id || driver.itinerary === null) continue;
    const legs = driver.itinerary.legs;
    const first = legs[0];
    if (first === undefined) continue;

    let vehicleId: number | null = null;
    let boardTicks = 0;
    let holdTicks = TRAVEL_BOARDING_WAIT_TICKS;
    if (first.onArrive.kind === 'board' && first.onArrive.passenger !== true) {
      vehicleId = first.onArrive.vehicleId;
      boardTicks = first.estTicks;
    } else if (first.boardingHold === true) {
      vehicleId = first.vehicleId;
      holdTicks = first.dwellLeft ?? first.dwellTicks ?? 0;
    }
    if (vehicleId === null) continue;

    const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId);
    if (vehicle === undefined || vehicle.type !== 'travel_vehicle') continue;
    if (vehicleDriverId(vehicle) !== null && vehicleDriverId(vehicle) !== driver.id) continue;
    const driveLeg = legs.find(l => l.mode === 'drive' && l.vehicleId === vehicleId);
    if (driveLeg === undefined || driveLeg.onArrive.kind !== 'alight') continue;

    const seatsTaken = Math.max(vehicle.occupantIds.length, 1) + committedPassengers(state, vehicleId, passenger.id);
    if (seatsTaken >= vehicleSeatCount(vehicle)) continue;

    hosts.push({ driver, vehicle, driveLeg, boardTicks, holdTicks });
  }
  return hosts;
}

/**
 * Makes the driver about to set off in `vehicleId` wait for the passenger now walking to it:
 * a zero-length leg right after their board leg that holds them at the shuttle for at most
 * `TRAVEL_BOARDING_WAIT_TICKS`. A no-op when the driver already holds, has left, or is not there.
 */
function addBoardingHold(state: GameState, vehicleId: number): void {
  const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId);
  if (vehicle === undefined) return;
  for (const driver of state.employees.employees) {
    const itinerary = driver.itinerary;
    const first = itinerary?.legs[0];
    if (!driver.alive || itinerary == null || first === undefined) continue;
    if (first.onArrive.kind !== 'board' || first.onArrive.passenger === true || first.onArrive.vehicleId !== vehicleId) continue;
    if (itinerary.legs[1]?.boardingHold === true) return;
    itinerary.legs.splice(1, 0, {
      mode: 'foot',
      vehicleId,
      destX: vehicle.x,
      destZ: vehicle.z,
      arrival: 'exact',
      onArrive: { kind: 'none' },
      estTicks: TRAVEL_BOARDING_WAIT_TICKS,
      dwellTicks: TRAVEL_BOARDING_WAIT_TICKS,
      boardingHold: true,
    });
    itinerary.estTotalTicks += TRAVEL_BOARDING_WAIT_TICKS;
    return;
  }
}

/** After `itinerary` is installed on a passenger, holds the shuttle it boards for them. */
export function holdShuttleForPassenger(state: GameState, itinerary: Itinerary): void {
  const first = itinerary.legs[0];
  if (first?.onArrive.kind === 'board' && first.onArrive.passenger === true) addBoardingHold(state, first.onArrive.vehicleId);
}

/** True while `emp` rides `vehicleId` as a passenger. */
export function isRidingAs(state: GameState, emp: Employee, vehicleId: number): boolean {
  const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId);
  return vehicle !== undefined && vehiclePassengerIds(vehicle).includes(emp.id);
}

/** Carries every passenger of `vehicle` to its position, so a mounted employee always stands where their vehicle does (I2). */
export function carryPassengers(state: GameState, vehicle: Vehicle): void {
  for (const id of vehiclePassengerIds(vehicle)) {
    const rider = state.employees.employees.find(e => e.id === id);
    if (rider === undefined) continue;
    rider.x = vehicle.x;
    rider.z = vehicle.z;
  }
}

/**
 * Whether a passenger standing at their board leg must keep waiting: the shuttle's driver is not
 * aboard yet. The wait is bounded by `TRAVEL_BOARDING_WAIT_TICKS`; once spent this returns false
 * and the board step then fails, ending the itinerary.
 */
export function holdForDriver(state: GameState, leg: Leg): boolean {
  if (leg.onArrive.kind !== 'board' || leg.onArrive.passenger !== true) return false;
  const vehicleId = leg.onArrive.vehicleId;
  const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId);
  if (vehicle === undefined || vehicleDriverId(vehicle) !== null) return false;
  const left = leg.boardWaitLeft ?? TRAVEL_BOARDING_WAIT_TICKS;
  if (left <= 0) return false;
  leg.boardWaitLeft = left - 1;
  return true;
}

/** Whether a driver's boarding hold keeps the shuttle at the kerb this tick: only while a boarder is still on the way. */
export function holdsForBoarders(state: GameState, leg: Leg): boolean {
  return leg.boardingHold === true && leg.vehicleId !== null && hasBoardingPassengers(state, leg.vehicleId);
}
