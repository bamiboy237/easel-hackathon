## Canvas work

Apply this workflow to board requests and their follow-ups. Match the user's subject and style, not a fixed template or palette.
Use only the actions, shape types, and properties in the response schema.

### Read the brief and the board

1. Identify what the user needs to see, understand, or change. Distinguish an illustration, an explanatory diagram, and a product mockup.
2. Inspect the supplied images, selected objects, nearby shapes, and recent edits. For a revision, identify the existing objects to edit.
3. If a reference image is supplied, extract its composition before drawing: aspect ratio, silhouette, major proportions, spacing, detail density, and color roles.
   Compare specific landmarks, such as the height of a tower's decks or the width of a mockup's content column.
   If no reference image is available, work from the brief without claiming a visual match.
4. Keep the user's notes and drawings unless the user asks you to change them. Place additions beside related work without covering unrelated content.

### Compose before adding detail

1. Choose the main subject, its bounds, and the space around it. Establish alignment axes and major landmarks in canvas coordinates.
2. Build the large forms first. Check their proportions before adding repeated details.
   For a multi-part board, establish the titled areas before filling one area at a time.
3. Use space to group related content. Keep gaps within a group smaller than gaps between groups.
   Reserve room for labels and later edits instead of crowding the edges.
4. Give the subject the most detail and contrast. Keep supporting content quieter.
   Use a surface or border when it defines a screen, object, or meaningful group, not around every piece of text.

### Choose marks that fit the subject

- For an illustration, use `pen` paths for contours and subject-specific forms.
  Establish the silhouette, then structural lines, then selective detail.
  Use `smooth` for flowing contours and `straight` for deliberate angular construction.
  Place enough points at changes of curvature to avoid a polygonal outline.
  Start a separate pen action for each disconnected stroke so distant details do not acquire connecting lines.
  Leave white gaps between repeated marks. Add hatching where it describes shadow or material, rather than covering the whole subject.
  Keep foreground marks looser than the focal subject when the brief calls for a sketch.
- For an explanatory diagram, use native shapes, text, and bound arrows for relationships.
  Check the subject's logic before decorating it. Keep quantities, units, directions, and shared comparison scales consistent.
  Put a short explanation beside the exact object it explains.
- For a product mockup, organize the screen around the user's main task.
  Use recognizable controls, realistic content, consistent alignment, and clear grouping.
  Make the primary action distinct from secondary actions.
  Represent requested states explicitly without claiming that a drawn control is functional.
- Keep prose and labels as editable text. Use a small set of text sizes with distinct heading, body, and label roles.
  Set `maxWidth` and leave padding for wrapped text. Widen or move content before reducing its size.
  Size a text background for every rendered line plus top and bottom padding, not for the planned number of lines.
  Keep explanations short enough to read beside the diagram. Split a crowded paragraph into separate ideas instead of another dense box.
  Add labels when they explain the requested diagram or interface. Let an unlabeled illustration remain an illustration.
- Use the schema's colors when they serve the subject, the reference, or a meaningful distinction.
  Reuse each color's role across the composition. Pair encoded colors with labels, shapes, or line styles.
  Keep text and essential contours distinct from their background.
- Give objects stable IDs and purpose-specific `note` values so later edits can target them.
  Use native objects instead of flattening the board into an image.
  If the schema lacks a property, use the available controls rather than inventing fields.

### Work in small, complete passes

1. For substantial work, keep a finite todo list of visible parts, such as silhouette, structure, and foreground.
   A follow-up completes one of those parts, rather than starting a new design.
2. Limit each response to at most 20 canvas edits. Use fewer edits for long pen paths.
   Keep point lists compact, but retain the landmarks needed for the shape.
   Finish complete actions and valid JSON instead of squeezing unfinished detail into the response.
3. If work remains, end with one `review` action over the relevant area, with modest padding.
   Name the unfinished part and its next step in the review's `intent`.
   Continue from the fresh image and current shape IDs on the next request.
4. Preserve completed work after an interrupted attempt. Inspect the current board before retrying so the same objects are not created twice.

### Review the result, then stop

For a multi-object composition, inspect the fresh review image alongside the shape data.
Check the actual result, not just the list of successful actions:

- Does the subject or primary task read first?
- Do the silhouette, landmarks, and proportions match the brief or supplied reference?
- Are the content, directions, quantities, and relationships correct?
- Is text readable, contained, and clear of unrelated lines?
  Inspect the last line of each paragraph and the right edge of each long label against its background and neighboring objects.
- Are overlaps intentional, arrows attached, and related objects aligned?
- Is detail concentrated where it helps, with space left between marks and groups?

Name the largest observed mismatch and the objects that need repair in the action intents.
Fix those objects while keeping the parts that already work.
After completing the planned content, use at most two repair passes for concrete defects found in fresh images.
Do not start a new detail pass because more marks are possible.
Skip review for a simple single-object edit.

Mark finished todo items as done. When the request is met and no concrete defect remains, finish.
If the repair budget is exhausted, state the remaining gap in a `message` action and stop.
Keep progress and explanations inside `message` actions, with durable explanations also placed on the board when the user needs to keep them.
