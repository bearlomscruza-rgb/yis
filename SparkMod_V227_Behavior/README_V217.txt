SparkMod V217: Bolt Titan - explosions, shutdown cycle, possession, custom SFX + VFX
- Death explosions: the first body blows apart after a 1.5 s fuse (power 4, no block damage).
  The final Possessed Titan does a 4 s light show with a warning circle and accelerating beeps,
  then a huge explosion (power 7, no block damage), then the XP fountain and loot.
- Final phase shutdown cycle: every 30 s the Possessed Titan SHUTS DOWN for 10 s.
  It slumps over, smokes and sparks, can't move or attack and takes +50% damage.
  A "REBOOTING IN N" countdown shows on screen. When it reboots, chain lightning hits
  everything within 100 blocks: players are stunned (can't move) and everything levitates for 5 s.
- Possession: the Spark Demon now hunts the nearest mob OR survival player. The possession
  takes 3 s, and the host can't be hurt or killed while it happens. A possessed player survives:
  the Titan bursts out of them and throws them clear.
- 16 custom synthesized sound effects (sounds/sparkmod/*.ogg): zaps, charge-ups, beams, slams,
  roar, cannon, teleport, shutdown, reboot, countdown beeps, hum, possession, giant explosion, demon.
  Regenerate them with tools/make_sfx.py.
- New particles (particles/fx_*.json): lightning arcs, glowing orbs, ground warning circles,
  shockwave rings, sonic pulses, bouncing sparks, rock debris, smoke, charge-up energy, aura motes.
- Every ability got new visuals and sounds: Spark Stun (lightning bolt + electric cage),
  Spark Boom (charge-up + glowing beam + sonic rings), Overload (huge charge orb + thick beam),
  Spark Cannon (glowing orb with lightning trail), Downslam (warning circle, shockwaves, debris,
  ground cracks), Scream (sonic pulses), teleport, melee hits, emergence, and an ambient aura.
- Camera shake on big hits, slams, beams, reboots and explosions.
