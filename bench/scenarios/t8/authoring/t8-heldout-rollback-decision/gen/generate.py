#!/usr/bin/env python3.12
"""Writes the large data files of t8-heldout-rollback-decision into ./fixture (run from the dir that holds fixture/ and gen/).

Seeded facts (see key_values.py for the numbers the key uses):
- from 13:10 UTC oa-3 and oa-4 run 4.18.0; oa-1 and oa-2 stay on 4.17.3;
- on 4.18.0 a share of payment authorisations comes back as a soft decline because the gateway sees a reused
  idempotency key (HTTP 200 to the client, so the 5xx rate does not move);
- 13:35 to 13:55 a maps vendor outage slows every host, both versions (the decoy);
- baseline soft declines (issuer, funds, expired card) on every host all day.
"""
import csv
import datetime as dt
import os
import random

SEED = 4417
OUT = 'fixture'
DAY = dt.datetime(2026, 11, 20, 10, 0, tzinfo=dt.timezone.utc)
MINUTES = 270  # 10:00 to 14:29
ROLLOUT = dt.datetime(2026, 11, 20, 13, 10, tzinfo=dt.timezone.utc)
MAPS_FROM = dt.datetime(2026, 11, 20, 13, 35, tzinfo=dt.timezone.utc)
MAPS_TO = dt.datetime(2026, 11, 20, 13, 55, tzinfo=dt.timezone.utc)
HOSTS = ['oa-1', 'oa-2', 'oa-3', 'oa-4']
NEW_HOSTS = {'oa-3', 'oa-4'}
OLD, NEW = '4.17.3', '4.18.0'
BASE_DECLINE = 0.004
REUSE_DECLINE = 0.021
BASE_REASONS = ['issuer_soft_decline', 'insufficient_funds', 'card_expired', 'issuer_soft_decline']
ROUTES = ['GET /v2/catalog', 'GET /v2/cart', 'POST /v2/cart/items', 'GET /v2/slots', 'POST /v2/checkout', 'GET /v2/orders']

rnd = random.Random(SEED)


def ts(t, ms=None):
    ms = rnd.randint(0, 999) if ms is None else ms
    return t.strftime('%Y-%m-%dT%H:%M:%S') + f'.{ms:03d}Z'


def rid():
    return 'r-' + ''.join(rnd.choice('0123456789abcdef') for _ in range(10))


def version_of(host, t):
    return NEW if host in NEW_HOSTS and t >= ROLLOUT else OLD


def p99_of(t):
    if MAPS_FROM <= t < MAPS_TO:
        return rnd.randint(880, 1420)
    return rnd.randint(210, 290) + (25 if 12 <= t.hour < 13 else 0)


def main():
    os.makedirs(f'{OUT}/logs/orders-api', exist_ok=True)
    os.makedirs(f'{OUT}/metrics', exist_ok=True)
    host_lines = {h: [] for h in HOSTS}
    gw_lines = []
    edge_lines = []
    rows = {}
    for m in range(MINUTES):
        t0 = DAY + dt.timedelta(minutes=m)
        for h in HOSTS:
            v = version_of(h, t0)
            lunch = 1.25 if 12 <= t0.hour < 13 else 1.0
            requests = int(rnd.randint(160, 200) * lunch)
            attempts = int(rnd.randint(20, 32) * lunch)
            p99 = p99_of(t0)
            fivexx = sum(1 for _ in range(requests) if rnd.random() < 0.003)
            declines = []
            for _ in range(attempts):
                r = rnd.random()
                if r < BASE_DECLINE:
                    declines.append(rnd.choice(BASE_REASONS))
                elif v == NEW and r < BASE_DECLINE + REUSE_DECLINE:
                    declines.append('idempotency_key_reused')
            completed = attempts - len(declines)
            key = (t0, v)
            row = rows.setdefault(key, [0, 0, 0, 0, 0, 0, 0])
            row[0] += 1
            row[1] += requests
            row[2] += fivexx
            row[3] = max(row[3], p99)
            row[4] += attempts
            row[5] += len(declines)
            row[6] += completed
            lines = host_lines[h]
            for _ in range(fivexx):
                lines.append((t0 + dt.timedelta(seconds=rnd.randint(0, 59)), f'ERROR orders-api host={h} version={v} req={rid()} route={rnd.choice(ROUTES)} status={rnd.choice([500, 502, 503, 503])} dur_ms={rnd.randint(20, 3000)} err={rnd.choice(["inventory timeout", "db pool wait", "upstream reset"])}'))
            lines.append((t0 + dt.timedelta(seconds=5), f'INFO orders-api host={h} version={v} req={rid()} route=GET /healthz status=200 dur_ms={rnd.randint(1, 4)}'))
            for s in (17, 47):
                route = rnd.choice(ROUTES)
                dur = rnd.randint(40, 200) if p99 < 500 else rnd.randint(300, 1300)
                extra = ' payment=approved' if route == 'POST /v2/checkout' else ''
                lines.append((t0 + dt.timedelta(seconds=s), f'INFO orders-api host={h} version={v} req={rid()} route={route} status=200 dur_ms={dur}{extra}'))
            if p99 >= 500 and rnd.random() < 0.7:
                lines.append((t0 + dt.timedelta(seconds=rnd.randint(0, 59)), f'WARN orders-api host={h} version={v} req={rid()} route=GET /v2/slots slow upstream=maps-geo dur_ms={rnd.randint(900, 1500)}'))
            if rnd.random() < 0.08:
                lines.append((t0 + dt.timedelta(seconds=rnd.randint(0, 59)), f'WARN orders-api host={h} version={v} req={rid()} inventory lookup retry attempt=2 dur_ms={rnd.randint(80, 300)}'))
            if rnd.random() < 0.05:
                lines.append((t0 + dt.timedelta(seconds=rnd.randint(0, 59)), f'WARN orders-api host={h} version={v} cache=catalog miss_rate_high value=0.{rnd.randint(21, 34)}'))
            for reason in declines:
                at = t0 + dt.timedelta(seconds=rnd.randint(0, 59))
                q = rid()
                order = rnd.randint(7300000, 7399999)
                lines.append((at, f'INFO orders-api host={h} version={v} req={q} route=POST /v2/checkout status=200 dur_ms={rnd.randint(150, 420)} order=o-{order} payment=soft_decline reason={reason}'))
                gat = at - dt.timedelta(milliseconds=rnd.randint(40, 120))
                if reason == 'idempotency_key_reused':
                    cart = rnd.randint(500000, 599999)
                    prev = rnd.randint(2400, 9800)
                    now = prev + rnd.choice([-1, 1]) * rnd.randint(150, 1200)
                    gw_lines.append((gat, f'WARN payments-gateway req={q} merchant=basketry idem_key=cart-{cart} result=soft_decline code=IDEMPOTENCY_KEY_REUSED amount_prev={prev} amount_now={now}'))
                else:
                    code = {'issuer_soft_decline': 'ISSUER_SOFT', 'insufficient_funds': 'NSF', 'card_expired': 'EXPIRED_CARD'}[reason]
                    gw_lines.append((gat, f'INFO payments-gateway req={q} merchant=basketry idem_key=ord-{order} result=soft_decline code={code}'))
        if m % 2 == 0:
            gw_lines.append((t0 + dt.timedelta(seconds=30), f'INFO payments-gateway heartbeat acquirer=northbank latency_ms={rnd.randint(30, 70)}'))
        for _ in range(3):
            gw_lines.append((t0 + dt.timedelta(seconds=rnd.randint(0, 59)), f'INFO payments-gateway req={rid()} merchant=basketry idem_key=ord-{rnd.randint(7300000, 7399999)} result=approved'))
        for _ in range(4):
            slow = MAPS_FROM <= t0 < MAPS_TO and rnd.random() < 0.5
            if slow:
                edge_lines.append((t0 + dt.timedelta(seconds=rnd.randint(0, 59)), f'WARN edge pop=lon2 route=GET /v2/slots upstream=maps-geo status=504 upstream_timeout_ms=1200 backend={rnd.choice(HOSTS)}'))
            else:
                edge_lines.append((t0 + dt.timedelta(seconds=rnd.randint(0, 59)), f'INFO edge pop=lon2 route={rnd.choice(ROUTES)} status=200 backend={rnd.choice(HOSTS)} ms={rnd.randint(30, 260)}'))
        if m % 15 == 0:
            edge_lines.append((t0, 'INFO edge tls certificate check ok days_left=61'))

    def write(path, lines):
        # Lines made at a whole second get random milliseconds, ascending within the second, so each log stays in order.
        timed = []
        for t, text in lines:
            if not t.microsecond:
                t = t + dt.timedelta(milliseconds=rnd.randint(0, 999))
            timed.append((t, text))
        timed.sort(key=lambda x: x[0])
        with open(path, 'w', encoding='utf-8', newline='\n') as f:
            for t, text in timed:
                f.write(f'{ts(t, t.microsecond // 1000)} {text}\n')

    for h in HOSTS:
        write(f'{OUT}/logs/orders-api/{h}.log', host_lines[h])
    write(f'{OUT}/logs/payments-gateway.log', gw_lines)
    write(f'{OUT}/logs/edge.log', edge_lines)
    with open(f'{OUT}/metrics/per-minute.csv', 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(['minute', 'version', 'hosts', 'requests', 'http_5xx', 'p99_latency_ms', 'payment_auth_attempts', 'payment_auth_soft_declines', 'checkout_completed'])
        for (t0, v), r in sorted(rows.items()):
            w.writerow([t0.strftime('%Y-%m-%dT%H:%MZ'), v, *r])


if __name__ == '__main__':
    main()
