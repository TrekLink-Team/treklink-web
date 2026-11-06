# PR 395 viewport review

Checked on 2026-11-05 and repeated on 2026-11-06 after rebasing onto dev ba271efb, using local Chromium,
the implemented Manager console and mocked API data:
25 groups, 20 device rows and 40 total paginated results. This is UI review evidence, not a staging run.

All 28 viewport/theme combinations passed layout assertions and axe checks tagged WCAG 2 A/AA,
2.1 A/AA and 2.2 AA, with zero reported violations. Automated checks do not establish full accessibility
conformance. Desktop checks focused the final group. Every case focused and scrolled the final device
into view. Visual inspection covered desktop, phone, expanded group controls and reflow end states.
At ordinary heights, each table viewport shows at least one complete row below its pinned header.
Short-phone controls were also opened, checked with axe and operated by keyboard. Manage groups
was clicked directly to verify that the floating panel stays above the table header. Selection and
Escape refocus behavior is covered by GroupTree's component regression.

| CSS viewport | Light | Dark | Main client / scroll height | Table client / scroll height |
|---|---|---|---|---|
| 1440 x 1000 | [Image](light-1440x1000.png) | [Image](dark-1440x1000.png) | 924 / 924 | 683 / 1262 |
| 1280 x 900 | [Image](light-1280x900.png) | [Image](dark-1280x900.png) | 824 / 824 | 583 / 1262 |
| 900 x 900 | [Image](light-900x900.png) | [Image](dark-900x900.png) | 824 / 824 | 583 / 1822 |
| 360 x 800 | [Image](light-360x800.png) | [Image](dark-360x800.png) | 660 / 660 | 235 / 1822 |
| 320 x 800 | [Image](light-320x800.png) | [Image](dark-320x800.png) | 660 / 660 | 235 / 1822 |
| 1440 x 900 | [Image](light-1440x900.png) | [Image](dark-1440x900.png) | 824 / 824 | 583 / 1262 |
| 1280 x 800 | [Image](light-1280x800.png) | [Image](dark-1280x800.png) | 724 / 724 | 483 / 1262 |
| 1280 x 720 | [Image](light-1280x720.png) | [Image](dark-1280x720.png) | 644 / 644 | 403 / 1262 |
| 900 x 800 | [Image](light-900x800.png) | [Image](dark-900x800.png) | 724 / 724 | 483 / 1822 |
| 360 x 740 | [Image](light-360x740.png) | [Image](dark-360x740.png) | 600 / 600 | 309 / 1822 |
| 360 x 640 | [Image](light-360x640.png) | [Image](dark-360x640.png) | 500 / 500 | 213 / 1822 |
| 320 x 640 | [Image](light-320x640.png) | [Image](dark-320x640.png) | 500 / 500 | 213 / 1822 |
| 320 x 568 | [Image](light-320x568.png) | [Image](dark-320x568.png) | 428 / 428 | 141 / 1822 |
| 318 x 236 | [Image](light-318x236.png) | [Image](dark-318x236.png) | 2247 / 2247 | 1822 / 1822 |

The last case simulates the CSS viewport available at 400 percent zoom. Native browser zoom was not
set. At this short height, the shell bars release and the document scrolls.
The [light end state](light-318x236-end.png) and [dark end state](dark-318x236-end.png) show the focused
last device reached. Table columns retain their own horizontal scrolling at narrow
widths. The document did not overflow horizontally in any case.

The [light group panel](light-320x568-groups-open.png) and [dark group panel](dark-320x568-groups-open.png)
show the opened controls above the table at the smallest ordinary phone height.

The second-review revision keeps asset tags on one line. Below 1440 px, variant and battery appear
under the tag and state rather than in separate columns. At all 1280 px cases the table scroll box
has client width and scroll width 704 px, so Actions is visible without scrolling sideways.

Four additional checks opened an ending device's menu with an existing fault, at 1280 and 900 px
in both themes. All six actions remained in order. The disabled Report fault item exposed its full
reason as its accessible description, and Enter neither opened a dialog nor closed the menu. Axe
reported zero violations and the menu bounds stayed entirely inside the viewport after the hint
appeared. The reason is outside the button's visible label in the shared Menu, and placement is
recomputed when focus or hover changes the hint size.

The repeated run passed all 28 viewport cases and four opened-menu cases with zero reported axe
violations. Representative desktop, short-phone and disabled-menu screenshots were visually inspected.
The shared Menu component tests also cover a disabled click without focus and mouse hover/unhover.

| Opened menu | Light | Dark |
|---|---|---|
| 1280 x 900 | [Image](light-1280x900-actions.png) | [Image](dark-1280x900-actions.png) |
| 900 x 900 | [Image](light-900x900-actions.png) | [Image](dark-900x900-actions.png) |

Course handbook sections 1.5 and 11 were re-read before the layout update. The screenshots were compared
with screen 5.7, RentedDevicesPage, GroupTree and the shared shell. The wireframe topology was unchanged.
