# Use 满版 for Chinese full-bleed wording

## Backlog item

**Clarify zh-CN full-bleed wording**

Goal: use natural Chinese copy for artwork that fills the output area.

## Decisions

1. Use `满版` for all three zh-CN catalog values whose English keys describe
   full-bleed artwork or output.
2. Keep the English keys and en-US values unchanged.
3. Update the i18n glossary and use-case description assertions in lockstep
   with the catalog.

## Reasoning

`全出血` can be read as hemorrhaging rather than as a design or print term.
`满版` communicates the intended filled-canvas result directly. `全幅` was
rejected because it can imply image or frame width, while `出血满版` retains
the same distracting hemorrhage reading and adds unnecessary print jargon.
Updating both test assertions with the catalog prevents the documented
translation and use-case copy from drifting.

## Follow-ups

None.
