# Online Holds and Waitlist System - Requirements

## Non-Functional Requirements: notes
**R40**: System must scale to support 50,000+ active patrons with projected 5-year growth.
**R41**: All patron data encrypted in transit and at rest.
**R42**: Performance degradation graceful, not catastrophic, during high load.
**R43**: Documentation for staff and patrons in multiple formats (video, text, in-person training).

### 8. Staff Workflows: notes
**R36**: Staff interface must allow bulk operations (multiple holds, notifications) and provide central dashboard of all holds across branches.
**R37**: Training mode with sample data required for staff practice before launch.
**R38**: Audit logging for all patron transactions and staff overrides.
**R39**: Reporting: daily holds placed, completion rates, waitlist lengths, branch utilization.

### 7. Accessibility and Technical: notes
**R28**: Core hold placement and management must meet WCAG 2.1 AA compliance at launch. Advanced features (analytics dashboard, recommendation engine) have 6-month grace period.
**R29**: System must work with JAWS, NVDA, and VoiceOver screen readers. All interactive elements require ARIA labels.
**R30**: Keyboard navigation required for all functions with visible focus indicators.
**R31**: Color contrast ratio minimum 4.5:1 for normal text, 3:1 for large text.
**R32**: Mobile responsive design with touch targets minimum 44x44 pixels.
**R33**: Integration with LibraryWorld ILS v7.2 via SIP2 for patron authentication and batch data sync every 15 minutes.
**R34**: Support 500 concurrent users during peak hours with page load under 3 seconds, API response under 1 second.
**R35**: 99.5% uptime requirement with contingency plan for manual hold processing during outages.

### 6. Fines and Policy Compliance: notes
**R24**: No fines for holds placed after March 1, 2024 that expire unclaimed. Existing fines from before March 1 will be collected but patrons can appeal for waiver if they use new system within 60 days of launch.
**R25**: Replacement fees apply for lost or damaged items ($25 minimum or actual cost).
**R26**: COPPA compliance mandatory for under-13 accounts with parent consent for data collection.
**R27**: Data retention: hold history limited to 18 months maximum, anonymized after 6 months.

### 5. Branch Operations: notes
**R19**: All physical branches (Central, Westside, Eastside, North Hill, Riverside) launch together in Phase 1 (Q2 2024).
**R20**: Bookmobile services launch in Phase 2 (August 2024). School delivery service remains manual and excluded from automated system.
**R21**: Branch capacity limits must be enforced: Central 200 holds, Westside 150, Eastside 75, North Hill 50, Riverside 40 (temporary during renovation).
**R22**: Inter-library holds only available at Central and Westside branches.
**R23**: System must support branch transfers with tracking and estimated transfer times (1-3 business days).

### 4. Waitlist Management: notes
**R15**: Physical book waitlists must support maximum 25 patrons per title across all branches.
**R16**: E-book waitlists for OCOU titles: 24-hour checkout window after notification, one automatic renewal if no one is waiting.
**R17**: When hold expires or is cancelled, item automatically goes to next patron in waitlist with 24-hour notification window.
**R18**: Patrons can suspend their waitlist position (vacation hold) for up to 30 days annually.

### 3. Pickup and Notification: notes
**R10**: Pickup window is 7 days for Central, Westside, and Eastside branches. North Hill branch gets 10-day window due to limited hours. Central branch provides after-hours pickup lockers.
**R11**: Notification channels: email primary, SMS/text backup for holds ready alerts. Phone calls only for seniors who opt in and for all institutional holds.
**R12**: All notifications must include pickup branch, item title, and pickup deadline. E-book notifications must include 24-hour checkout window.
**R13**: For children's cards under 12, parents receive separate notifications by default. Opt-out requires in-person visit to branch with ID verification.
**R14**: Multiple notification attempts: email day 1, SMS day 3, phone call day 6 (where applicable).

### 2. Hold Limits and Card Types: notes
**R6**: Hold limits per card type: regular cards 12 items, student cards 15 items during school year (September-June), senior cards (65+) 10 items, children's cards (under 12) 5 items, institutional cards 20 items with manager approval required over 10 items.
**R7**: Summer reading program participants (June-August) receive +2 additional holds on children's and young adult cards.
**R8**: Children's cards cannot place holds on adult (18+) materials without parent override.
**R9**: Student cards receive priority during exam periods (December and May) at Westside branch through partnership with local schools.

### 1. Holds Placement and Management: notes
**R1**: Patrons must be able to place holds on available physical books through web interface, mobile-responsive site, or staff-assisted channels.
**R2**: The system must support holds for e-books using the One Copy One User (OCOU) licensing model with integrated waitlists.
**R3**: Real-time availability checking across all branches must be provided, with updates at minimum 15-minute intervals.
**R4**: Patrons must be able to view their current holds, waitlist position, and estimated availability dates.
**R5**: Staff must have override capabilities for special cases (institutional cards, lost items, manual corrections).

## Functional Requirements: notes

## Overview: notes
The County Library Service requires a new online holds and waitlist system for physical books and e-books. This system must improve patron access, streamline staff workflows, and comply with all board directives and accessibility standards.

## Assumptions: notes
1. LibraryWorld ILS upgrade to v8.0 in Q3 2024 will provide better API access.
2. County fiber network provides sufficient bandwidth for all branches.
3. Patrons have basic digital literacy for web interface use; in-person assistance available.
4. E-book vendor (DigitalRead Inc.) will provide API integration as per contract.
5. Staff training will be completed before system launch.
6. Existing phone system will remain operational during transition period.
7. Budget of $350,000 covers development, implementation, and first-year operations.
8. Board approval for Phase 2 (bookmobile) contingent on Phase 1 success metrics.

```json
{
    "assumptions": [
        "LibraryWorld ILS upgrade to v8.0 in Q3 2024 will provide better API access.",
        "County fiber network provides sufficient bandwidth for all branches.",
        "Patrons have basic digital literacy for web interface use; in-person assistance available.",
        "E-book vendor (DigitalRead Inc.) will provide API integration as per contract.",
        "Staff training will be completed before system launch.",
        "Existing phone system will remain operational during transition period.",
        "Budget of $350,000 covers development, implementation, and first-year operations.",
        "Board approval for Phase 2 (bookmobile) contingent on Phase 1 success metrics."
    ],
    "requirements": [
        {
            "text": "Patrons must be able to place holds on available physical books through web interface, mobile-responsive site, or staff-assisted channels.",
            "id": "R1"
        },
        {
            "text": "The system must support holds for e-books using the One Copy One User (OCOU) licensing model with integrated waitlists.",
            "id": "R2"
        },
        {
            "text": "Real-time availability checking across all branches must be provided, with updates at minimum 15-minute intervals.",
            "id": "R3"
        },
        {
            "text": "Patrons must be able to view their current holds, waitlist position, and estimated availability dates.",
            "id": "R4"
        },
        {
            "text": "Staff must have override capabilities for special cases (institutional cards, lost items, manual corrections).",
            "id": "R5"
        },
        {
            "text": "Hold limits per card type: regular cards 12 items, student cards 15 items during school year (September-June), senior cards (65+) 10 items, children's cards (under 12) 5 items, institutional cards 20 items with manager approval required over 10 items.",
            "id": "R6"
        },
        {
            "text": "Summer reading program participants (June-August) receive +2 additional holds on children's and young adult cards.",
            "id": "R7"
        },
        {
            "text": "Children's cards cannot place holds on adult (18+) materials without parent override.",
            "id": "R8"
        },
        {
            "text": "Student cards receive priority during exam periods (December and May) at Westside branch through partnership with local schools.",
            "id": "R9"
        },
        {
            "text": "Pickup window is 7 days for Central, Westside, and Eastside branches. North Hill branch gets 10-day window due to limited hours. Central branch provides after-hours pickup lockers.",
            "id": "R10"
        },
        {
            "text": "Notification channels: email primary, SMS/text backup for holds ready alerts. Phone calls only for seniors who opt in and for all institutional holds.",
            "id": "R11"
        },
        {
            "text": "All notifications must include pickup branch, item title, and pickup deadline. E-book notifications must include 24-hour checkout window.",
            "id": "R12"
        },
        {
            "text": "For children's cards under 12, parents receive separate notifications by default. Opt-out requires in-person visit to branch with ID verification.",
            "id": "R13"
        },
        {
            "text": "Multiple notification attempts: email day 1, SMS day 3, phone call day 6 (where applicable).",
            "id": "R14"
        },
        {
            "text": "Physical book waitlists must support maximum 25 patrons per title across all branches.",
            "id": "R15"
        },
        {
            "text": "E-book waitlists for OCOU titles: 24-hour checkout window after notification, one automatic renewal if no one is waiting.",
            "id": "R16"
        },
        {
            "text": "When hold expires or is cancelled, item automatically goes to next patron in waitlist with 24-hour notification window.",
            "id": "R17"
        },
        {
            "text": "Patrons can suspend their waitlist position (vacation hold) for up to 30 days annually.",
            "id": "R18"
        },
        {
            "text": "All physical branches (Central, Westside, Eastside, North Hill, Riverside) launch together in Phase 1 (Q2 2024).",
            "id": "R19"
        },
        {
            "text": "Bookmobile services launch in Phase 2 (August 2024). School delivery service remains manual and excluded from automated system.",
            "id": "R20"
        },
        {
            "text": "Branch capacity limits must be enforced: Central 200 holds, Westside 150, Eastside 75, North Hill 50, Riverside 40 (temporary during renovation).",
            "id": "R21"
        },
        {
            "text": "Inter-library holds only available at Central and Westside branches.",
            "id": "R22"
        },
        {
            "text": "System must support branch transfers with tracking and estimated transfer times (1-3 business days).",
            "id": "R23"
        },
        {
            "text": "No fines for holds placed after March 1, 2024 that expire unclaimed. Existing fines from before March 1 will be collected but patrons can appeal for waiver if they use new system within 60 days of launch.",
            "id": "R24"
        },
        {
            "text": "Replacement fees apply for lost or damaged items ($25 minimum or actual cost).",
            "id": "R25"
        },
        {
            "text": "COPPA compliance mandatory for under-13 accounts with parent consent for data collection.",
            "id": "R26"
        },
        {
            "text": "Data retention: hold history limited to 18 months maximum, anonymized after 6 months.",
            "id": "R27"
        },
        {
            "text": "Core hold placement and management must meet WCAG 2.1 AA compliance at launch. Advanced features (analytics dashboard, recommendation engine) have 6-month grace period.",
            "id": "R28"
        },
        {
            "text": "System must work with JAWS, NVDA, and VoiceOver screen readers. All interactive elements require ARIA labels.",
            "id": "R29"
        },
        {
            "text": "Keyboard navigation required for all functions with visible focus indicators.",
            "id": "R30"
        },
        {
            "text": "Color contrast ratio minimum 4.5:1 for normal text, 3:1 for large text.",
            "id": "R31"
        },
        {
            "text": "Mobile responsive design with touch targets minimum 44x44 pixels.",
            "id": "R32"
        },
        {
            "text": "Integration with LibraryWorld ILS v7.2 via SIP2 for patron authentication and batch data sync every 15 minutes.",
            "id": "R33"
        },
        {
            "text": "Support 500 concurrent users during peak hours with page load under 3 seconds, API response under 1 second.",
            "id": "R34"
        },
        {
            "text": "99.5% uptime requirement with contingency plan for manual hold processing during outages.",
            "id": "R35"
        },
        {
            "text": "Staff interface must allow bulk operations (multiple holds, notifications) and provide central dashboard of all holds across branches.",
            "id": "R36"
        },
        {
            "text": "Training mode with sample data required for staff practice before launch.",
            "id": "R37"
        },
        {
            "text": "Audit logging for all patron transactions and staff overrides.",
            "id": "R38"
        },
        {
            "text": "Reporting: daily holds placed, completion rates, waitlist lengths, branch utilization.",
            "id": "R39"
        },
        {
            "text": "System must scale to support 50,000+ active patrons with projected 5-year growth.",
            "id": "R40"
        },
        {
            "text": "All patron data encrypted in transit and at rest.",
            "id": "R41"
        },
        {
            "text": "Performance degradation graceful, not catastrophic, during high load.",
            "id": "R42"
        },
        {
            "text": "Documentation for staff and patrons in multiple formats (video, text, in-person training).",
            "id": "R43"
        }
    ]
}
```
