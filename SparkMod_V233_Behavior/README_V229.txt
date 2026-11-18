SparkMod V229: god armour rules, pity, /deck3, Spark Chestplate, mace effects

GOD ARMOUR IS ONE-OF-A-KIND
- Only the piece handed out by a Spark roll can exist. Copies taken from the creative inventory
  or made with commands (/give, /replaceitem...) are deleted within a quarter second, wherever they
  are (inventory, armour slots, held item, dropped, nearby chests/entities).
- While a piece exists (or has been rolled) it can't be rolled again.
- If the piece is DESTROYED (lava, fire, cactus, explosion, despawn, armour breaking) or falls into
  the VOID, its roll slot is released and everyone is told it can be rolled again.
- Pieces rolled before V229 are adopted automatically the first time they are seen.
  Limits: items in ender chests or unloaded chunks can't be seen by scripts.

PITY: 15 Spark Tokens spent without unique Spark gear makes the next roll guaranteed unique gear.
      The roll menu shows your pity counter.

/deck3 (operators; also /sparkmod:deck3, or /scriptevent sparkmod:deck3 on older builds)
- Toggle clearing of locator maps, toggle clearing of bundles, set the ordinary mace limit and the
  Spark Mace limit. Clearing is now near-instant (maps and bundles every 1/10-1/5 s + on every
  inventory change). Bedrock scripts can't tell locator maps from plain maps, so all maps are cleared
  while the setting is on.

SPARK CHESTPLATE
- A hit that would kill you is cancelled and triggers SPARK MODE: you keep everything, lightning
  strikes everyone within 24 blocks, you are immortal for 10 seconds with Speed IV and Strength II.
- When it ends you are DRAINED: every hit you land does 2 less damage and you move at about half
  speed (Slowness III) - and the chestplate can't save you again - until you recharge it at the
  Spark Shrine (the Spark Altar) for 3 Spark Tokens.

ARMOUR EFFECTS (awakened = awakened at the Spark Shrine)
- Helmet: Weaving I.  Chestplate: +16 hearts (closest Bedrock step to 15), awakened +20 hearts.
- Leggings: Resistance I, awakened II.  Boots: Speed I, awakened Speed III.

SPARK MACE: smashes, critical-chain lightning, Thor Storm, Thor Mode activation, Thunder Crash
and Lightning Judgment now have custom sounds, lightning bolts from the sky, shockwave rings,
flashes, sparks, rubble and screen shake.
