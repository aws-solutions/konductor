# Parcel Tool

Parcel Tool calculates domestic shipping prices and prints labels for the
warehouse desk. It is a small Python 3.12 command line application with no
third-party dependencies.

## Running it

The repository root is the import path. A rate can be printed as text or JSON:

```sh
python3 cli.py rate --zone 2 --weight 3.5 --service priority
python3 cli.py rate --zone 2 --weight 3.5 --json
python3 cli.py label data/sample-order.json
```

Rates combine the zone table, a weight band, the service multiplier, fuel, and
optional delivery fees. An unlisted zone uses the fallback domestic zone. The
calendar module supplies the dates used for holiday fees and dispatch windows.

The plain-text label format is designed for thermal printers. It includes the
order identifier, recipient, wrapped address, service, optional price, and a
short check value.

## Development

The visible test suite uses only the standard library:

```sh
python3 -m unittest discover -s tests
```

The CI job runs the same command on Python 3.12. Sample files are deliberately
small so the command can also be tried from a checkout without setup.
