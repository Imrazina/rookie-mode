export type GlossaryTerm = {
  canonicalTerm: string
  aliases: string[]
  explanation: string
}

export const f1Glossary: GlossaryTerm[] = [
  { canonicalTerm: 'DRS', aliases: ['drs', 'drag reduction system'], explanation: 'A flap that opens on the rear wing to reduce drag and help a car gain speed on a straight.' },
  { canonicalTerm: 'SLIPSTREAM', aliases: ['slipstream', 'tow', 'draft'], explanation: 'The car ahead cuts through the air, reducing drag for the car behind.' },
  { canonicalTerm: 'DIRTY AIR', aliases: ['dirty air', 'turbulent air'], explanation: 'Messy airflow from the car ahead that makes it harder for the following car to grip in corners.' },
  { canonicalTerm: 'UNDERCUT', aliases: ['undercut'], explanation: 'Pitting earlier than a rival to use fresh tyres and jump ahead when they stop.' },
  { canonicalTerm: 'OVERCUT', aliases: ['overcut'], explanation: 'Staying out longer than a rival and using faster laps to get ahead after your own pit stop.' },
  { canonicalTerm: 'TYRE DEGRADATION', aliases: ['tyre degradation', 'tire degradation', 'tyre deg', 'tire deg'], explanation: 'The gradual loss of tyre performance as the rubber wears and overheats.' },
  { canonicalTerm: 'GRAINING', aliases: ['graining', 'grained tyres', 'grained tires'], explanation: 'When small pieces of rubber roll up on the tyre surface, reducing grip until the tyre clears itself.' },
  { canonicalTerm: 'BLISTERING', aliases: ['blistering', 'blistered tyres', 'blistered tires'], explanation: 'Heat damage that creates bubbles in the tyre rubber and reduces grip.' },
  { canonicalTerm: 'LOCK-UP', aliases: ['lock-up', 'lock up', 'locked up', 'locking up'], explanation: 'When a tyre stops rotating under braking and slides across the track, damaging the tyre.' },
  { canonicalTerm: 'TRACK LIMITS', aliases: ['track limits', 'track limit'], explanation: 'The rules defining how far a driver may run beyond the edge of the circuit.' },
  { canonicalTerm: 'DELTA', aliases: ['delta time', 'delta'], explanation: 'The time difference to a target lap time, another driver, or a required speed limit.' },
  { canonicalTerm: 'PIT WINDOW', aliases: ['pit window'], explanation: 'The ideal range of laps to make a pit stop and still achieve the strategy goal.' },
  { canonicalTerm: 'LIFT AND COAST', aliases: ['lift and coast', 'lift off and coast'], explanation: 'Lifting off the throttle before braking to save fuel, tyres, or the car’s brakes.' },
  { canonicalTerm: 'POLE POSITION', aliases: ['pole position', 'pole'], explanation: 'First place on the starting grid, earned by setting the fastest qualifying time.' },
  { canonicalTerm: 'SAFETY CAR', aliases: ['safety car'], explanation: 'A car that slows and groups the field after an incident so track conditions can be made safe.' },
  { canonicalTerm: 'VIRTUAL SAFETY CAR', aliases: ['virtual safety car', 'vsc'], explanation: 'A caution period where every driver must slow to a controlled pace without the field bunching up.' },
  { canonicalTerm: 'PARC FERMÉ', aliases: ['parc ferme', 'parc fermé'], explanation: 'The rules that heavily restrict car setup changes after qualifying begins.' }
]
