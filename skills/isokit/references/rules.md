# The rules

What a finished figure holds to. Each one came from a mistake that was easy to make.

## Geometry

1. **True isometric, never perspective.** Far things do not shrink. Lift along z; never scale to fake height.
2. **Paint order is depth.** Back to front: lower z first, smaller x + y first; rows by y, then columns by x. Thin slabs that overlap on screen: the higher one is nearer and goes last.
3. **Faces are opaque.** Every solid is filled, so whatever is behind it is hidden. A far edge showing through a near face means the paint order is wrong.
4. **Rounded corners, drawn honestly.** Use `Box`: its outline is the hull of its rounded top and foot, so no vertical corner line is drawn and no flat face pokes past a rounded corner.
5. **Draw on faces, not polygons.** Anything on a surface goes in that face's flat coordinates through `top`, `front` or `side`.
6. **Frame the extreme pose.** `fit` includes every raised, opened or exploded position, so nothing leaves the plate.

## Light and colour

7. **One live thing.** At rest exactly one stroke or dot is `--ik-live`, where the eye should start. When the reader presses something, the live stroke moves to it. Never two places at once.
8. **Bright outside, dim inside.** Silhouettes in `--ik-line`, inner marks in `--ik-detail`. Texture comes from repetition (vents, key grids, ribs), never from gradients or shadows.
9. **Every theme and look.** Check light and dark, and the blueprint, paper and phosphor looks. Never hard-code a colour; use the `--ik-*` properties.
10. **Emission is not attention.** Only what is switched on glows, and only inside `<Glow>`: an LED, an awake screen's text, a signal on a wire. Never a face, never a pressable part. Light ignites fast and fades slowly, and on light themes it is a darker fill, not a halo.
11. **Three line weights.** Box draws silhouettes at `--ik-weight-edge`, creases at `--ik-weight-crease` and inner marks at `--ik-weight-fine`. Do not override them per figure; the hierarchy is what makes a drawing read at a glance.

## Interaction

12. **Pressing produces output.** Every press changes something you can read: the screen, a light, the read-out.
13. **Act on release.** `Press` goes down on press and acts on release, like a key. Parts that lift (folders, lids) use `ik-lift`.
14. **Hit areas do not jump.** Hover changes colour only, never position. If a part moves for another reason, make sure the pointer still lands on it in the moved pose. Stepped stands and spacing give back parts a real target.
15. **Everything works from the keyboard.** Each `Press` has a label that says what it does.
16. **The read-out is terse.** Lowercase, dot-separated, a few words: `draft · 4 blocks`. It changes on every interaction.

## Motion

17. **Time comes from tokens.** Never write a literal duration or curve for a kind of motion the kit has a token for: `--ik-t-state` and `--ik-t-move` on `--ik-ease` for discrete changes, `--ik-ease-move` for travel, `--ik-ease-fall` for drops, `--ik-spring` over `--ik-t-spring` for settling, `--ik-stagger` between neighbours. Presses go down in `--ik-t-press` and spring back; the bench tunes all of them at once. The one exception is a duration a sound must land with: keep it as a constant in the figure, hand it to CSS as a custom property, and time the sound from the same constant.
18. **Springs on release only.** A `linear()` spring jumps if it is interrupted, so anything the reader can retrigger mid-flight eases out instead.
19. **Stagger by position.** Things that move together start lowest-first or nearest-first, `--ik-stagger` apart, so it reads as one gesture.
20. **Loops are rare and sleep.** Only ambient motion loops (a waiting light, a floating draft); mark it `ik-loop` so it pauses offscreen. Reduced motion keeps short fades and drops every movement.
21. **Never CSS-transform an element that has a `transform` attribute.** Wrap it in a `<g>` and move the wrapper.

## Sound

22. **Sound follows the reader.** Only play what the reader caused, at the moment the visual change happens. The cascade lands in step with the staggered animation.
23. **Two layers.** The part's click comes from `Press`, shaped by its `material`, size and position. The result sound is yours, and every complication brings its own mechanical sound.
24. **Quiet by default.** Nothing plays until the page opts in and the reader has interacted. Short, soft, and never the only feedback.
25. **Cut stale sounds.** Keep the `stop` from `playSound` for anything a newer action replaces, and always for `motor`.

## Text

26. **Text fits at every width.** Screens hold a few short words; measure monospace at 0.6 em per character. If it does not fit, shorten the words before you shrink the font.
27. **Legibility over decoration.** Screen text at least about 6 units; anything smaller is texture, not content.

## Guided motion

28. **Show it once, then hand it over.** A figure presses its own primary part once, the first time it is in view (`useDemoTap`), silently, and never again after the reader touches it.
29. **The live stroke says "press here".** At rest the one live thing is the part to press, with a `Ripple` under it until the first press. After a press the live stroke moves to the result or to the next part to press, never to two places.
30. **Motion runs from the cause to the result.** A signal leaves the key and reaches the screen; a part flies from where it was to where it goes. The result confirms where it lands, and in the read-out.
31. **Nothing moves that is not news.** Every loop is a waiting signal (`ik-loop`); every transition reports a change of state.

## Complications and drafting

32. **A complication is caused.** It runs on the path from the press to the result, and never idles. At most one at levels 1 and 2, two at level 3, three at level 4.
33. **Every complication sounds.** A detent ticks, a lid latches, a relay clicks, a drive hums for as long as it runs.
34. **Dimensions are read-outs.** A `Dimension` names what it measures in its label and moves with the part. Drafting shows only in a look that turns it on, so the figure must read without it.
