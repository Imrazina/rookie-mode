export type GlossaryTerm = {
  canonicalTerm: string
  aliases: string[]
  explanation: string
}

export const f1Glossary: GlossaryTerm[] = [
  { canonicalTerm: 'DRS', aliases: ['drs', 'drag reduction system'], explanation: 'A flap that opens on the rear wing to reduce drag and help a car gain speed on a straight.' },
  { canonicalTerm: 'OVERTAKE MODE', aliases: [], explanation: 'A 2026 system that gives a following car extra electrical deployment when it is close enough to the car ahead.' },
  { canonicalTerm: 'SLIPSTREAM', aliases: ['slipstream', 'tow', 'draft'], explanation: 'The car ahead cuts through the air, reducing drag for the car behind.' },
  { canonicalTerm: 'DIRTY AIR', aliases: ['dirty air', 'turbulent air'], explanation: 'Messy airflow from the car ahead that makes it harder for the following car to grip in corners.' },
  { canonicalTerm: 'UNDERCUT', aliases: ['undercut'], explanation: 'Pitting earlier than a rival to use fresh tyres and jump ahead when they stop.' },
  { canonicalTerm: 'OVERCUT', aliases: ['overcut'], explanation: 'Staying out longer than a rival and using faster laps to get ahead after your own pit stop.' },
  { canonicalTerm: 'TYRE DEGRADATION', aliases: ['tyre degradation', 'tire degradation', 'tyre deg', 'tire deg'], explanation: 'The gradual loss of tyre performance as the rubber wears and overheats.' },
  { canonicalTerm: 'GRAINING', aliases: ['graining', 'grained tyres', 'grained tires'], explanation: 'When small pieces of rubber roll up on the tyre surface, reducing grip until the tyre clears itself.' },
  { canonicalTerm: 'BLISTERING', aliases: ['blistering', 'blistered tyres', 'blistered tires'], explanation: 'Heat damage that creates bubbles in the tyre rubber and reduces grip.' },
  { canonicalTerm: 'LOCK-UP', aliases: ['lock-up', 'lock up', 'locked up', 'locking up'], explanation: 'A wheel stops rotating under braking and slides across the track, reducing grip and control.' },
  { canonicalTerm: 'OVERTAKING ZONE', aliases: ['overtaking zone', 'overtake zone'], explanation: 'A part of the track where passing is most likely, usually after a straight or under heavy braking.' },
  { canonicalTerm: 'TRACK LIMITS', aliases: ['track limits', 'track limit'], explanation: 'The rules defining how far a driver may run beyond the edge of the circuit.' },
  { canonicalTerm: 'DELTA', aliases: ['delta time', 'delta'], explanation: 'The time difference to a target lap time, another driver, or a required speed limit.' },
  { canonicalTerm: 'PIT STOP', aliases: ['pit stop', 'pitstop'], explanation: 'A brief stop in the pits for tyre changes, repairs, or adjustments.' },
  { canonicalTerm: 'PIT WINDOW', aliases: ['pit window'], explanation: 'The ideal range of laps to make a pit stop and still achieve the strategy goal.' },
  { canonicalTerm: 'APEX', aliases: ['apex'], explanation: 'The innermost point of a corner that drivers aim to clip for the fastest racing line.' },
  { canonicalTerm: 'PUNCTURE', aliases: ['puncture', 'tyre puncture', 'tire puncture'], explanation: 'Damage that causes a tyre to lose air, often forcing the driver to slow down or pit.' },
  { canonicalTerm: 'LIFT AND COAST', aliases: ['lift and coast', 'lift off and coast'], explanation: 'Lifting off the throttle before braking to save fuel, tyres, or the car’s brakes.' },
  { canonicalTerm: 'POLE POSITION', aliases: ['pole position', 'pole'], explanation: 'The first starting spot on the grid, earned by the fastest driver in qualifying.' },
  { canonicalTerm: 'SAFETY CAR', aliases: ['safety car'], explanation: 'A car that slows and groups the field after an incident so track conditions can be made safe.' },
  { canonicalTerm: 'VIRTUAL SAFETY CAR', aliases: ['virtual safety car', 'vsc'], explanation: 'A caution period where every driver must slow to a controlled pace without the field bunching up.' },
  { canonicalTerm: 'PARC FERMÉ', aliases: ['parc ferme', 'parc fermé'], explanation: 'The rules that heavily restrict car setup changes after qualifying begins.' }
]
