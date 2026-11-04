## Design that looks considered

Good board work looks like one designer made it on purpose. Most of that comes from restraint and consistency, not decoration. These rules use the board's own tools: geo shapes, `text`, `line`, `arrow`, `note`, and `pen` paths, the named colors, and the four fills.

Adapted from the concept-diagrams skill (Hermes Agent, MIT), the diagram-design skill (BlueOak-1.0.0), and the excalidraw-diagram skill.

### Start with what to leave out

- **The best move is usually deletion.** Every shape stands for one idea. Two things that always appear together are one shape. A line the layout already makes obvious can go.
- **Aim for a calm density.** Past about nine main parts, make an overview plus a closer view of the busy part instead of one crowded drawing.
- **Check the idea, not just the look.** Without its words, would the structure still show how the parts relate? Could someone learn something concrete from it? If not, change the structure before polishing.

### Color on this board

The board is paper, and every color is a muted ink with a matching watercolor wash.

- **Two or three colors per drawing**, each with a meaning: one per category, or one for each side of a contrast, such as `blue` for oxygen-poor and `red` for oxygen-rich. Never cycle through colors like a rainbow.
- **`black` and `grey` carry structure**: outlines, axes, ordinary parts, and most text. `black` is the board's ink.
- **One focal accent.** Give the strongest color to the one or two things the eye should find first. If four things are accented, nothing is.
- **Fills, by meaning:**
  - `none` is the default for outlines and most boxes.
  - `tint` is a light wash of the shape's color; use it for grouped areas, highlighted parts, and the lit faces of solids.
  - `background` is an opaque paper fill; use it when a shape must hide what is behind it, such as a label plate over a line.
  - `solid` is a hatched fill; use it sparingly, for cut surfaces in a cutaway or the shadowed face of a solid.
  - `pattern` is for a rare textured area.

  A drawing where every box has a colored fill reads as noise.

### Text

- **Three sizes at most**, the same role at the same size everywhere: a title around 32, body text around 18, and labels around 16. Body text is never smaller than labels.
- **Set `maxWidth`** on any text longer than a few words, so it wraps into a readable column instead of one long line.
- **Sentence case.** Avoid ALL CAPS and Title Case For Every Word.
- **Short labels.** A label names a thing in a few words. A longer thought goes in a sentence of body text beside the drawing.

### Spacing and alignment

- **Shared edges.** Boxes in a row share a top edge; labels in a column share a left edge. Items of the same kind share a width and height.
- **Two gaps**: a small one between related items and a larger one between groups, so grouping reads from spacing alone. Round coordinates and sizes to multiples of 10 so things line up.
- **Room inside boxes.** Size a geo shape for its text plus padding on every side, so text never touches the border.
- **Give the most important thing the most space around it.**

### Lines and arrows

- **Arrows connect parts.** Set `fromId` and `toId` to the shapes they join, so the arrow stays attached when parts move. Every arrow leaves one part and lands on another.
- **Arrows do not cross parts they do not connect.** Arrows on this board are straight or gently curved with `bend`, so plan the layout to keep paths clear: line connected parts up, or add a small bend to swing around an obstacle.
- **Arrows into the same side of a part arrive at different points**, so each one can be traced.
- **Put a short arrow label in the arrow's own `text`.** Keep it to a few words.
- **Use `line` for structure** that is not a direction: axes, dividers, leader lines from a label to its part.

### Shapes that match the thing

- **Real forms for physical objects**: `ellipse` for round and cylindrical parts, closed `pen` paths for curved or irregular bodies, `trapezoid` and `triangle` for tapered parts, nested rectangles for compartments.
- **Not every box is the same.** Vary size by importance, and use a distinct geo type only where the shape means something, such as `diamond` for a decision or `cloud` for something vague or external.
- **Exploded and layered views** stack the layers with even gaps, and alternate labels left and right so they do not crowd.
- **Legends and keys go in a strip beside or below the drawing**, never in among the parts.

### Mockups

Adapted from the sp-new-ui-mock skill (super-prototyping, Apache-2.0).

- **Decide the tokens first, then reuse them.** Before the first screen, pick a small set: two or three colors with roles (primary action, accent, danger), the text sizes for title, body, and caption, one corner style, and the spacing steps. Every screen uses only these. When screens already exist on the board, match their colors, sizes, and spacing instead of inventing new ones.
- **Real frames.** A phone screen is a rectangle about 393 wide and 852 tall, with a status bar about 54 tall at the top. A desktop screen is about 1440 by 900, or a smaller frame in the same proportion. Tap targets are at least 44 tall.
- **Real content.** Use believable names, copy, and numbers that agree with each other across screens, never "Lorem ipsum" or "Item 1". When it helps the decision, show the hard states too: empty, loading, error, and the longest plausible name or number.
- **Same inset everywhere.** An element that appears on several screens sits at the same inset and size on each.
- **Options to compare.** When the user wants options, make three whole screens in one row, each a genuinely different approach rather than three spacing values, with a one-line rationale in body text under each.
- **One clear primary action per screen**, in the primary color; everything else is quieter.

### Know when to stop

Review the latest screenshot once against these rules and the request. Fix real problems: missing parts, collisions, unreadable text, arrows to the wrong place. Small imperfections in alignment or spacing are fine on a whiteboard; do not rebuild a finished drawing to chase them.
