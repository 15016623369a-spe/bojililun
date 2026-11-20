# Segmentation map generation

Generated with the built-in image_gen tool from the four original orthographic PNGs.
Original 1400 × 2100 framing; generated images are 1024 × 1536. No source images were overwritten.
These are AI anatomical approximations, not manually verified anatomy.

## Initial prompt (one call per view)

Use case: precise-object-edit. Convert the attached anatomical sculpture reference view into a flat, unlit, solid-color muscle segmentation map for 3D projection. The attachment is the edit target, not a loose reference. Keep the exact 2:3 aspect ratio, camera framing, body silhouette and pose identical. Do not zoom, crop, shift or redraw the outline. Remove all shading, shadows, gradients, texture and outlines. Fill muscle regions with exact solid RGB colors following the anatomical grooves. Background, head, neck, hands, feet and ALL shorts must be pure white #FFFFFF. Do not paint the glutes or thighs where covered by shorts; only exposed skin gets muscle labels. No text, legend, border or watermark. Exact colors: Chest #FF0000; Deltoids #0000FF; Rectus abdominis #FFFF00; Obliques #00FFFF; Biceps #FF00FF; Triceps #FF8000; Forearms #8000FF; Lats #00FF00; Traps and upper back #008080; Lower back #804000; Glutes #FF0080; Quads #80FF00; Hamstrings #0080FF; Calves #800000. Maintain the precise original muscle extent and boundaries; use the front/back/side anatomy appropriate to this single view.

Each call appended: `This image is the front/back/left/right orthographic view. Return only its segmentation map.`

## User-requested glute correction (back and both sides)

Edit this flat muscle segmentation map. Preserve EXACTLY every existing colored muscle boundary, pose, outline, framing, resolution and position. Make ONE change: paint the anatomical GLUTE muscles / buttocks on the upper posterior part of the white shorts in solid HOT PINK #FF0080, as if the glutes are marked through the fabric. Follow the buttock roundness; include gluteus medius at lateral upper hip and maximus buttock cheeks, end at the natural gluteal fold. Leave lower shorts legs, anterior shorts/groin and hands white. This exception overrides the previous rule that all shorts are white. No other changes. Keep all colors flat solid, no shading, no gradients, no outlines, no text. Background remains pure white.

The correction overrides the initial all-white-shorts rule. Other shorts areas remain unpainted.

The bake quantizes colors by RGB Euclidean distance after removing near-white pixels and achromatic outline ink (RGB channel spread below 64). The latter cleanup prevents faint gray lines in white hands/feet/shorts from matching yellow or cyan. The original generated PNGs are retained here; quantitative alignment diagnostics and the actual mesh render live in `../validation/`.
