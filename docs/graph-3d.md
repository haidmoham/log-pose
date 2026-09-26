# temporal graph 3d view

The temporal graph defaults to its existing 2d map. The visible 2d/3d switch changes only the presentation. Candidate IDs, evidence edges, selected years and inspector behavior stay unchanged.

The 3d view derives a stable depth coordinate from each candidate ID and projects the retained 2d anchor through a perspective camera. Depth changes point size, paint order and atmospheric opacity for orientation; it does not encode time, strength, confidence or evidence. Drag or use arrow keys to orbit. A short damped settle follows pointer movement when graph motion is enabled; reduced motion updates directly. The graph takes ownership after 5 pixels of mouse movement or 9 pixels of touch movement, so a click still selects a node. Shift-drag or shift-arrow pans. Modified wheel, plus and minus zoom. Reset restores the fitted 3d camera. There is no automatic rotation.

The 2d pan/zoom camera and 3d orbit/pan/zoom camera persist separately while the temporal source and focused company stay the same. They also survive year and selected-edge renders. A new source or focused company resets both cameras to fitted defaults.

Ordinary nodes use a small playful display palette of sky blue, mint, periwinkle and occasional coral. The candidate ID chooses the tint, so it remains stable through time and in both views. Color carries no category or evidence meaning. Gold remains reserved for focus, selection and local interaction.
