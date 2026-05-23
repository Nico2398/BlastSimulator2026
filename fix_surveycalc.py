import re

with open('tests/unit/mining/SurveyCalc.test.ts', 'r') as f:
    content = f.read()

# Define replacement pairs: (old_pattern, new_pattern)
replacements = []

# Pattern 1: makeOreGrid - "rockId: 'granite'," followed by density+ores inside grid.setVoxel
replacements.append((
    "      rockId: 'granite',\n      density: 1,\n      oreDensities: { gold: 0.5 },\n      fractureModifier: 1.0,",
    "      composition: { rocks: [{ rockId: 'granite', coefficient: 1.0 }] },\n      density: 1,\n      oreDensities: { gold: 0.5 },\n      fractureModifier: 1.0,"
))

# Pattern 2: makeFilledOreGrid - double indentation
replacements.append((
    "          rockId: 'granite',\n          density: 1,\n          oreDensities: { gold: 0.5 },\n          fractureModifier: 1.0,",
    "          composition: { rocks: [{ rockId: 'granite', coefficient: 1.0 }] },\n          density: 1,\n          oreDensities: { gold: 0.5 },\n          fractureModifier: 1.0,"
))

# Pattern 3: makeAerialGrid
replacements.append((
    "        rockId: 'granite',\n        density: 1,\n        oreDensities: { copper: 0.4 },\n        fractureModifier: 1.0,",
    "        composition: { rocks: [{ rockId: 'granite', coefficient: 1.0 }] },\n        density: 1,\n        oreDensities: { copper: 0.4 },\n        fractureModifier: 1.0,"
))

# Pattern 4: basalt in aerial test
replacements.append((
    "      rockId: 'basalt',\n      density: 1,\n      oreDensities: { silver: 0.35 },\n      fractureModifier: 1.0,",
    "      composition: { rocks: [{ rockId: 'basalt', coefficient: 1.0 }] },\n      density: 1,\n      oreDensities: { silver: 0.35 },\n      fractureModifier: 1.0,"
))

# Pattern 5: inline gold 0.5 in test 11
replacements.append((
    "        rockId: 'granite',\n        density: 1,\n        oreDensities: { gold: 0.5 },\n        fractureModifier: 1.0,",
    "        composition: { rocks: [{ rockId: 'granite', coefficient: 1.0 }] },\n        density: 1,\n        oreDensities: { gold: 0.5 },\n        fractureModifier: 1.0,"
))

# Pattern 6: inline gold 0.6 in test 12
replacements.append((
    "        rockId: 'granite',\n        density: 1,\n        oreDensities: { gold: 0.6 },\n        fractureModifier: 1.0,",
    "        composition: { rocks: [{ rockId: 'granite', coefficient: 1.0 }] },\n        density: 1,\n        oreDensities: { gold: 0.6 },\n        fractureModifier: 1.0,"
))

for old, new in replacements:
    content = content.replace(old, new)

with open('tests/unit/mining/SurveyCalc.test.ts', 'w') as f:
    f.write(content)

print("Done. Remaining rockId occurrences:", content.count("rockId: '"))
