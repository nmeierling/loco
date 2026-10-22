We need to adapt the behaviour of the file double click in the heatmap view. Right now, it "switches" (in the main header on top) to the AST view with that file opened. I want a slightly different behaviour: Double clicking a file should open a new tab with that file in ast view. So we probably need to refactor the whole app shell a little: first tab being the heatmap view (this tab should be permanent and not closable), the "default" "ast" button/tab should vanish - ast view should only be available on a double click of a file. name of the tab should be the currently opened file name.



I want the double click to open files "in preview mode", meaning a file with more than 1500 lines should be opened but only show the first 1500 lines (and add a small banner on top of the editor signaling how many lines there are in total). I want this to work for every file extension (like MD and json). And I also want a hex editor for eg. binary files - is that possible?
Please also adapt the alginment of the editor. It should be on the left side, while the AST/Graph/usages view should be on the right.




- Ah I want for all picture extensions a picture preview instead of the hex editor please.
- Also, in the case where there is AST available, I want the "Usages" right side to be opened by default.
- Also, it seems that .sh files cannot be opened .. ?



- Make the "Preview — first 1,500 of 153,553 lines" with a yellow background please so its better to see
- clicking on a tab with shift pressed should close that tab (and make the mouse cursor into an x)


- in the preview bar, add a link to show the last 1500 lines of that file instead
- render a sticky pagination bar in case of a preview so user can page easily


- in the preview editor next to the path/name of that open file, show also the stats we got (loc, churn, etc.) about it
- also underneath the preview bar, render a bar with a search in whole file
- only show the top 20 hits (should be pagable as well)
- if the search hit is a value line, show only that line
- if the search hit is an array or object field name, render the line and the next (up to 3 ) lines of the array/object
- give a search hit the possibility to expand in to either direction by 5 lines, up or down


- the expand by 5 up and down should be visible when hovering over the first/last line number of that hit and of course appear there as the whole "line cell" (remove it from the upper right corner)



Ah I want the +5 hover next to the line on the right side (so "over the actual text of the line")


make the search show 50 items and if there are more, show a 51st row that says "+ x more". Also, show the pagination for the search as a new bar below the search, also show the total hits before the pagination stats

#

- each file tab should remember its state within the editor 


- in the graph view, the user should be able to drag and drop single nodes as he pleases
- also we need to dramatically improve the graph navigation. 





- I think the usages tab is still very unusful. Original idea was to see the classes that use this class (so "incoming") and see the classes that this opened file uses (so "outgoing"). Right now it shows something different - even the usages from within its own file, which are rather uninteresting for me - or lets say not useful in the current state. So it would be useful to see which method or property of a class is highly used from within itself. So lets use these three tabs: incoming, outgoing and self with the earlier described functions:
- incoming: see which classes use which method/property of this file - grouped by incoming class and ordered by amount of occurences
- outgoing: see which classes are used by this class (and which method/property) - grouped by outgoing class and ordered by amount of occurences
- self: ordered by amount of occurences



- currently the tab names are limited to somewhere around 22 chars. make that 40 chars, and if it exceeds that, render the first 10 chars, than the "..." and then the last 27 chars
- also it possible that the kotlin lsp does not work properly? I have a spring boot controller, that uses a springboot repository, but neither is shown in their respective incoming/outgoing tab


- the row with the usages tabs is rendered "above" the Ignore sidebar, please fix that
- the custom ignore entries should also support wildcard paths (like "*/src/test/*/)
- the usages content should also be based on the ignore list, so if a user ignored the whole test src, those symbols are not shown - is that feasible?



now the filter input in front of the tabs takes too much space, so the tabs are hidden behind the ignore sidebar, they should rearrange (so these tabs are always visible) and the size of the input text should change






lets refactor the app a little: 
- I want you to move the filename and path filter from the loco-filter-bar into the files sidebar: add a small filter button next to the "Files" title (in the expanded state). On click, the filename and path filter (each on their own row) will expand as a new row. if a filter is given, it cannot be collapsed and will always show
- remove the stats from the loco-filter-bar
- next to the "collapse Files sidebar" button, I want you to add the selection for the metric to be displayed next to the file/folder (also add file count as another metric to choose)
- move the VIZ tabs into the main area for when heatmap tab is opened (rename the heatmap tab to Overview)
- so i think we can get rid of the loco-filter-bar completely - ask me if i missed something










- the page title should reflect the chosen project(the folder name that is already shown in the upper right corner)
- show a small warn symbol in the upper right cornor if the .git data is not available
- explain the complexity metric in the help button
- remove the claim "lines of code, visualized" from the header
- build a custom logo and favicon for this project
- the "x" to close a tab should be on hover on a tab, and be positioned in the beginning of the text (not at the end)
- add a new metric: file size (dirs are computed from their containing files' sizes); use common abbreviations (K for thousand, M for Mega, G for Giga); two digits after the comma for G, no digits after the comma for the others
- completely remove the "caption" for the modes in the ast/file view





- for the ignore sidebar: add a small symbol next to the title (when expanded) that opens a new tab where all files are listed, that are now ignored (as a tree-list in the main area)


- Make the overview tab sticky so if there are more file tabs than fit, only those are scrolled. make sure the scrollbar is not visible, but show a "..." at the end (or beginning, depending on scroll state)



- move the change folder, cache status and help button into its own gear menu in the top right corner of the app (where "change folder" is now)
- use the name of the directory as the title for the first tab "Overview" and remove it from the top right corner
- 


- on the overview page, in the tab row of the main area (with List, Treemap, Sunburst,...) put the general (unfiltered!) stats of this folder on the right side
- also in the new menu, add a clipboard next to the folder-name that copies the original full path to the clipboard

- bump the aws budgets and
- add a confirmation dialog to the change folder button in the main menu (since it ends the current session)


- in the usages tab, do not show import and definition rows
- grouped under a class, a method right now needs to be expanded once more to see the call sites, i want you to show all call and read sites directly (for enum as well) after the first expand
- same with interface and property: show all property call (and read) directly on first expand
- as the first row in the single usages tabs, render a "expand/collapse all" button
- the external tab should not group by package, but also by class (or more appropriatly the full qualified name (so package/path and class name)), also only show read and call sites (not definition or import)
- please list me all types that we might encounter in the usages tabs (i am especially interested if there are more call types than read,import,definition,call ..?) (please answer this first before proceeding with the first parts)


Incoming -> Class


- actually, lets refactor the treemap tab a little. first of all it should be called heatmap
- second of all, the heatmap has two dimension: sizes of boxes and color. both should be independently choosable from within the main area (no more dependence on the metric selection in the filter)
- also List and module graph tab should not be affected by switching the metric in the files sidebar
- 

- we need to improve the dep matrix tab:
- a cell with a value higher than 0 should be clickable: on click, this exact pair is opened and shown which part depend on which - does that make sense? i feel like that what w




Lets build a new feature, the "Hotspots" viz. It should be a list view where the most used callsites (so method/member lvl) are listed.



Lets build a new feature. The "domain board". Put it as another viz on the main tab. The idea behind it, is the following: Most projects follow "some kind of internal" style guide/guideline regarding the naming of components, mostly those names have the same terms in them. The domain board, when opened first, should go through all those names, "chunk" by names and make recommendations on what the single domains could be consisting off.
The domain board should also be editable and persistable (in an indexdb in the local browser), so a user can manually improve and revisit this from time to time. It should be easy and fun to use, like putting stickies on a whiteboard kind of experience. Empty notes (as a tool/reminder for the user) should also be available. But I have no real idea on how this could look from a UI/UX perspective, maybe you can generate multiple ideas for that.


- the scrolling for a mac touchpad needs to smoother
- if an element is dragged and dropped onto a new domain group, the item should neatly align at the place it has been dropped (realign the sorrounding elements)
- also names tend to be pretty long, so please use a custom width per element, so the whole text fits
- i have the feeling that the "chunking" of terms is focused only on one term? Can we do that on multiple terms? Are there other ways to make a pre grouping work? any ideas?