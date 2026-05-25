  // totalDeaths = killedEmployeeIds.length + occupantCasualties.
  // killedEmployeeIds may contain duplicates when an employee is both
  // instant-killed and also an occupant who dies in the survival roll.
  const totalDeaths = killedEmployeeIds.length + occupantCasualties;