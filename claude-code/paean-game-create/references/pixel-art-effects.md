# Pixel animation and effects

## Decide what the player should see

Pick a frequent event and name the cue the player needs. For a sword strike, the wind-up
reveals the attack direction and a spark marks where the blade connects. For a collectible,
the turning silhouette makes it recognizable before pickup. For a wall torch, the moving
flame marks a place while leaving nearby hazards easy to see.

Draft the effect on the game's pixel grid, over a representative piece of the level. Look at
it at 1× and at its actual size on a phone. If the action disappears against the scenery,
simplify its silhouette and group adjacent pixels into distinct light and dark shapes.
Reserve the strongest highlight for the point the player should notice. Add glow or
particles only while that point and the surrounding playfield stay readable.

## Match the motion to the event

| Event | How to stage it | What to check in play |
| --- | --- | --- |
| Melee hit | Pull the weapon back, sweep it through the attack arc, then recover. Trigger the contact spark and target recoil from the confirmed hit, at the contact point. | Try a hit and a miss. Both show the swing. Only the hit gets the contact response. Scale any hit-stop or shake to the weight of the blow. |
| Pickup | Give the idle coin a repeating turn. On collection, end the idle animation and place a short accent where the coin was collected. | The accent coincides with the reward. Its last pixels fade or settle while the player can already read the next pickup. |
| Ambient loop | Keep the torch base anchored. Vary flame height and let embers rise and fade at different times. | Watch several cycles beside a hazard. The wrap should read like another frame of flame motion, and the hazard should keep its visual priority. |

## Review the frames and the timing

- **Inspect a strip of consecutive frames.** Include the actor and target for an attack. Track
  the weapon tip, contact point and planted foot. If contact seems early or the foot slides,
  compare the event frame and sprite pivots before adjusting particles. Check the last and
  first frames of loops together and the final frames of one-shots for abrupt cutoffs.
- **Replay at gameplay speed.** Trigger the effect against the backgrounds where it appears,
  including during movement or overlapping action. A strip can show a clean pose while a
  long hold still makes a quick strike feel late. Adjust the pose, timing or contrast that
  obscured the cue, then replay the same encounter.

## Optional pixelfx references

Use the gallery to find an effect with a similar shape or rhythm. Compare it with the
game's effect at the same on-screen size. [pixelfx gallery](https://patch-gg.github.io/pixelfx/)

For an authoring preview in a pixelfx checkout, `node tools/act.mjs melee/sword-slash`
renders a frame strip with the attacker and target. For a reusable loop,
`node tools/render.mjs pickups/coin-spin --sheet` exports a transparent PNG and JSON.
If using the sheet in a game, bundle the selected files locally and preserve the exported
pivot, frame timing and loop setting. [Upstream authoring guide](https://github.com/patch-gg/pixelfx/blob/044e12a45dc9cc312cec50ee606dfc98afe5adc2/docs/AUTHORING.md)

When redistributing upstream code, include the MIT license and applicable copyright notices.
The gallery's Patch Pixel font has separate terms. [License](https://github.com/patch-gg/pixelfx/blob/044e12a45dc9cc312cec50ee606dfc98afe5adc2/LICENSE) · [Third-party and font notices](https://github.com/patch-gg/pixelfx/blob/044e12a45dc9cc312cec50ee606dfc98afe5adc2/NOTICE.md)
