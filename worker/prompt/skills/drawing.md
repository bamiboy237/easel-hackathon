## Drawing complex things

Use this for anything with many parts: a machine, an organ, a 3D object, a system architecture, a dashboard. Simple sketches do not need all of it.

Adapted from the craft rules in Anatomy (github.com/wheresryan22/anatomy, MIT) and the excalidraw-diagram skill (github.com/coleam00/excalidraw-diagram-skill), rewritten for tldraw shapes.

### Plan before the first shape

1. **List the parts the request names**, and the few the subject cannot read without. A gyroscope needs its spinning wheel, axle, and stand before any vector makes sense. Keep this list: the work is not done until each part is on the board.
2. **Pick one view** and keep it: front, side, top, isometric, or a cutaway. Pick the view that shows the mechanism, not the one that is easiest to draw.
3. **Block out the big masses first.** Decide the overall size, then place the largest parts as simple shapes in their true proportions and positions. Detail and labels come after the masses are right.
4. **Work in passes.** One pass for the masses, one or more for structure and detail, then one for labels and notes. A complex drawing never fits in one response; finishing a pass well beats starting everything.

### Make it read as a real object

- **Proportions come from the real thing.** A bike's wheels are about as tall as its frame is long, and the crank sits low between them. Get the big relationships right before adding detail.
- **Every part rests on, joins, or connects to another part.** Nothing floats. A chain wraps the chainring and the cassette; an axle passes through the wheel's center.
- **Every line lands on something.** A leader line, arrow, or edge ends on the part it refers to, never in empty space.
- **Detail from structure, not texture.** Add the parts that do a job (bearings, bolts, valves, ports, rails) instead of decoration.
- **Restraint with color.** Stay mostly in the board's inks. Use one accent color for what the eye should find first, and color for meaning (oxygen-rich and oxygen-poor blood, one color per vector).

### 3D on a flat board

- **Isometric view.** For a point (x, y, z) with z up, draw it at screen position ((x − y) × 0.87, (x + y) × 0.5 − z). Compute the corners of each solid this way, then connect them with `line` or `pen` shapes. A cube shows three faces: top, left, and right.
- **Shade by face.** The top face is lightest, the face toward the light is medium, the face away from it is darkest. Use the same three tones for every solid.
- **Circles in 3D are ellipses.** A wheel or disk seen at an angle is an ellipse; the more it tilts away from you, the flatter it gets. A cylinder is two matching ellipses joined by two straight sides.
- **Paint far to near.** Create the parts farthest from the viewer first and the nearest last, so nearer parts cover farther ones. Split a part that wraps around another (a frame around a wheel) into a back half and a front half.
- **Show depth with overlap and size.** Nearer things are larger and cover farther things. Draw hidden edges only when the user asks for them, as thin dashed lines.
- **Vectors in 3D** start on the part they act on, point along a direction you can name relative to the axes, and get a short label at the tip.

### Diagrams of systems and ideas

- **Let the shape mirror the idea.** One thing feeding many: fan out. Many into one: converge. Steps in order: a line with dots. A loop: arrows returning to the start. A comparison: two columns side by side. Different parts of one diagram can use different patterns.
- **Text floats by default.** Titles, labels, and notes do not need a box around them. Box a thing only when it is a distinct part, something arrows connect to, or its shape carries meaning.
- **Relationships need arrows.** Two things placed near each other are not connected until a line or arrow says so, ideally with a short label on the arrow saying what passes along it.
- **Show what things actually look like.** In a technical diagram, put real names and a small real example (an event name, a sample input and output) where they teach, instead of a box that only says "data".

### Labels

- **Place labels in clear space beside the drawing**, with a thin leader line that ends on the part. Never write a label over a stroke, a filled shape, or another label.
- **Line labels up** in a column or along one side of the drawing when there are many, so they read as a set.
- **Fix collisions by moving the label to clear space**, not by nudging it a few pixels at a time. If one label still collides after two moves, put it in the nearest empty area with a longer leader line and move on.

### Check against the plan before you finish

Look at the latest screenshot and go through the parts list. Every named part is drawn and recognizable, every label sits on clear space and points at its part, and nothing overlaps that should not. Missing parts are the next pass. When everything is there and reads, stop.
