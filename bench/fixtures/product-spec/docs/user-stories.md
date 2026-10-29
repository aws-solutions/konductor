# User stories

## US-1: Place a hold
As a member, I want to place a hold on a checked-out title so that I get it when it is returned.
- Given a title with no available copy, when I place a hold, then I appear at the end of its queue.
- Given a title with an available copy, when I try to place a hold, then I am told to borrow it instead.

## US-2: See my place in line
As a member, I want to see my hold position so that I know how long I may wait.
- When I open my holds, then each hold shows its position in the queue.

## US-3: Be told when a copy is ready
As a member, I want an email when my hold is ready so that I can pick the book up.
- When a copy is returned and I am first in the queue, then I receive an email saying how long the copy is reserved.

## US-4: Cancel a hold
As a member, I want to cancel a hold so that I do not block others.
- When I cancel, then the members behind me each move up one place.

## US-5: Manage the queue as staff
As a librarian, I want to see and edit a title's hold queue so that I can fix mistakes.
- When I open a title's queue, then I see members in order with the date of each hold.
- When I remove a hold, then I must enter a reason and the member behind moves up.

## US-6: Weekly hold report
As a library manager, I want a weekly report of the most requested titles so that I can buy more copies.
- When the week ends, then I receive a list of titles ordered by number of holds.
