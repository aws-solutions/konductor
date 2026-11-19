# Rate table notes

Zone values represent distance bands from the dispatch center. The rate table
has a base amount for each zone and additive amounts for letter, small, medium,
large, and oversize parcels. The largest band is open-ended.

Fuel is calculated from the service-adjusted base amount. Residential, remote,
signature, holiday, and declared-value charges are separate additions. Monetary
values are displayed to two decimal places.

Dates are passed to the calendar rules as `datetime.date` values. The calendar
also supplies the next business day for warehouse reports.
