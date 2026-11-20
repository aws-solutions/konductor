#!/usr/bin/env python3.12
"""Writes the large data files of t8-heldout-incident-handoff into ./fixture (run from the dir that holds fixture/ and gen/).

Seeded facts (key_values.py prints the numbers the key uses):
- 14:02 UTC the flag bulk_tax_recalc is enabled for the enterprise-us segment; from then the tax-recalc job holds row
  locks on invoice_lines in long transactions for those tenants, so their invoice creation waits on locks and part of
  it times out (504); other tenants are fine;
- 13:50 UTC invoice-api 2.41.0 (email footer and log format only) is the decoy, and render-worker errors are loud
  downstream noise (it fetches invoices from invoice-api);
- the replica falls far behind from 14:05 under the recalc write load, so a failover would lose writes;
- nothing has been mitigated when the data ends at 16:30 UTC.
"""
import csv
import datetime as dt
import os
import random

SEED = 9203
OUT = 'fixture'
START = dt.datetime(2026, 11, 20, 12, 0, tzinfo=dt.timezone.utc)
MINUTES = 270  # 12:00 to 16:29
FLAG_ON = dt.datetime(2026, 11, 20, 14, 2, 11, tzinfo=dt.timezone.utc)
DEPLOY = dt.datetime(2026, 11, 20, 13, 50, tzinfo=dt.timezone.utc)
RESTART = dt.datetime(2026, 11, 20, 14, 44, tzinfo=dt.timezone.utc)

rnd = random.Random(SEED)


def tenants():
    out = []
    for i in range(1, 61):
        seg = 'enterprise-us' if i % 4 == 0 else rnd.choice(['smb-eu', 'smb-us', 'enterprise-eu', 'smb-us'])
        out.append((f't{100 + i}', seg))
    return out


TENANTS = tenants()
HIT = [t for t, s in TENANTS if s == 'enterprise-us']


def ts(t):
    return t.strftime('%Y-%m-%dT%H:%M:%S') + f'.{t.microsecond // 1000:03d}Z'


def at(t0, lo=0, hi=59):
    return t0 + dt.timedelta(seconds=rnd.randint(lo, hi), milliseconds=rnd.randint(0, 999))


def rid():
    return 'q' + ''.join(rnd.choice('0123456789abcdef') for _ in range(9))


def main():
    os.makedirs(f'{OUT}/logs', exist_ok=True)
    os.makedirs(f'{OUT}/metrics', exist_ok=True)
    os.makedirs(f'{OUT}/config', exist_ok=True)
    api, pg, rep, render, sched, flags = [], [], [], [], [], []
    rows = []
    pid = 4100
    xid = 991200
    for m in range(MINUTES):
        t0 = START + dt.timedelta(minutes=m)
        on = t0 >= FLAG_ON
        relief = RESTART <= t0 < RESTART + dt.timedelta(minutes=5)
        hit = 0.2 if relief else 0.55
        v = '2.41.0' if t0 >= DEPLOY else '2.40.3'
        lat = []
        fails = 0
        waits = 0
        for _ in range(rnd.randint(14, 20)):
            tenant, seg = rnd.choice(TENANTS)
            t = at(t0)
            if on and seg == 'enterprise-us' and rnd.random() < hit:
                if rnd.random() < 0.45:
                    api.append((t, f'ERROR invoice-api version={v} req={rid()} tenant={tenant} route=POST /v1/invoices status=504 dur_ms=30000 err="lock wait timeout on invoice_lines"'))
                    lat.append(30000)
                    fails += 1
                else:
                    d = rnd.randint(4000, 26000)
                    api.append((t, f'WARN invoice-api version={v} req={rid()} tenant={tenant} route=POST /v1/invoices status=201 dur_ms={d} slow=true'))
                    lat.append(d)
                waits += 1
            else:
                d = rnd.randint(90, 650)
                api.append((t, f'INFO invoice-api version={v} req={rid()} tenant={tenant} route=POST /v1/invoices status=201 dur_ms={d}'))
                lat.append(d)
        for _ in range(6):
            tenant, _seg = rnd.choice(TENANTS)
            api.append((at(t0), f'INFO invoice-api version={v} req={rid()} tenant={tenant} route={rnd.choice(["GET /v1/invoices", "GET /v1/customers", "GET /v1/invoices/{id}/pdf"])} status=200 dur_ms={rnd.randint(20, 300)}'))
        api.append((at(t0, 0, 2), f'INFO invoice-api version={v} route=GET /healthz status=200 dur_ms=2'))
        if rnd.random() < 0.06:
            api.append((at(t0), f'WARN invoice-api version={v} smtp relay slow ms={rnd.randint(800, 2400)}'))
        if t0 == DEPLOY:
            api.append((t0 + dt.timedelta(seconds=3), 'INFO invoice-api version=2.41.0 starting build=2.41.0+881 templates=email-footer-v7'))
        if t0 == RESTART:
            api.append((t0 + dt.timedelta(seconds=1), 'INFO invoice-api version=2.41.0 starting build=2.41.0+881 templates=email-footer-v7 reason=rollout-restart'))
        # database
        pg.append((at(t0, 0, 5), f'LOG:  connection stats: active={rnd.randint(18, 40) + (35 if on else 0)} idle={rnd.randint(5, 20)}'))
        if m % 5 == 0:
            pg.append((at(t0), f'LOG:  checkpoint complete: wrote {rnd.randint(400, 2200)} buffers; write={rnd.uniform(1, 9):.3f} s'))
        if rnd.random() < 0.15:
            pg.append((at(t0), f'LOG:  automatic vacuum of table "ledger.public.{rnd.choice(["customers", "payments", "audit_events"])}": index scans: 1'))
        if on:
            for _ in range(min(waits, 6)):
                tenant = rnd.choice(HIT)
                pid += 1
                xid += rnd.randint(1, 9)
                t = at(t0)
                wait_ms = rnd.uniform(1000, 30000)
                pg.append((t, f'LOG:  process {pid} still waiting for ShareLock on transaction {xid} after {wait_ms:.3f} ms'))
                pg.append((t, f'DETAIL:  Process holding the lock: {pid - rnd.randint(200, 900)}. Wait queue: {pid}. application_name=tax-recalc'))
                pg.append((t, f"STATEMENT:  INSERT INTO invoice_lines (invoice_id, tenant_id, amount_cents) VALUES ($1, '{tenant}', $2)"))
            if rnd.random() < 0.3:
                t = at(t0)
                most = max(5000, int((t - FLAG_ON).total_seconds() * 1000) - 2000)
                pg.append((t, f"LOG:  duration: {min(rnd.randint(60000, 290000), most)}.{rnd.randint(100, 999)} ms  statement: UPDATE invoice_lines SET tax_cents = recalc_tax(id) WHERE tenant_id = '{rnd.choice(HIT)}' application_name=tax-recalc"))
        # replica
        lag = rnd.uniform(0.2, 2.5) if t0 < FLAG_ON + dt.timedelta(minutes=3) else min(260.0, 30 + (t0 - FLAG_ON).total_seconds() / 60 * 1.7 + rnd.uniform(-8, 8))
        rep.append((at(t0, 0, 3), f'LOG:  replication status: replay_lag_s={lag:.1f} write_lag_s={lag * 0.9:.1f} state=streaming'))
        if rnd.random() < 0.1:
            rep.append((at(t0), 'LOG:  restartpoint complete'))
        # render worker
        n_err = rnd.randint(3, 7) if on else (1 if rnd.random() < 0.1 else 0)
        for _ in range(n_err):
            render.append((at(t0), f'ERROR render-worker job=pdf-{rnd.randint(100000, 999999)} fetch invoice from invoice-api failed: timeout after 10000 ms; retry {rnd.randint(1, 3)}/3'))
        for _ in range(3):
            render.append((at(t0), f'INFO render-worker job=pdf-{rnd.randint(100000, 999999)} rendered pages={rnd.randint(1, 6)} ms={rnd.randint(300, 1800)}'))
        if rnd.random() < 0.2:
            render.append((at(t0), 'WARN render-worker font cache rebuilt (fonts=212)'))
        # scheduler
        if m % 10 == 0:
            sched.append((at(t0, 0, 5), f'INFO billing-scheduler job=dunning-emails run started tenants={rnd.randint(40, 60)}'))
        if on and m % 2 == 0:
            tenant = rnd.choice(HIT)
            sched.append((at(t0), f'INFO billing-scheduler job=tax-recalc tenant={tenant} batch={rnd.randint(1, 40)} rows={rnd.randint(20000, 90000)} started'))
        if rnd.random() < 0.05:
            sched.append((at(t0), 'WARN billing-scheduler job=fx-rates provider slow, using cached rates'))
        rows.append([t0.strftime('%Y-%m-%dT%H:%MZ'), len(lat), fails, sorted(lat)[int(0.99 * (len(lat) - 1))], sorted(lat)[len(lat) // 2], waits, round(lag, 1), n_err])
    # flag audit
    flag_events = [
        (dt.datetime(2026, 11, 20, 9, 12, 4, tzinfo=dt.timezone.utc), 'flag=new_invoice_editor action=enable segment=smb-eu pct=100 by=akim change=UX-301'),
        (dt.datetime(2026, 11, 20, 11, 40, 51, tzinfo=dt.timezone.utc), 'flag=dark_mode action=enable segment=all pct=25 by=akim change=UX-288'),
        (dt.datetime(2026, 11, 20, 13, 21, 9, tzinfo=dt.timezone.utc), 'flag=pdf_watermark action=disable segment=all pct=0 by=lnovak change=DOC-77'),
        (FLAG_ON, 'flag=bulk_tax_recalc action=enable segment=enterprise-us pct=100 by=jporter change=TAX-512'),
        (dt.datetime(2026, 11, 20, 15, 5, 33, tzinfo=dt.timezone.utc), 'flag=dark_mode action=enable segment=all pct=50 by=akim change=UX-288'),
    ]
    for t, e in flag_events:
        flags.append((t, f'AUDIT flag-service {e}'))
    for m in range(0, MINUTES, 15):
        flags.append((at(START + dt.timedelta(minutes=m)), f'INFO flag-service sync ok flags=41 clients={rnd.randint(30, 36)}'))

    def write(path, lines):
        lines.sort(key=lambda x: x[0])
        with open(path, 'w', encoding='utf-8', newline='\n') as f:
            for t, text in lines:
                f.write(f'{ts(t)} {text}\n')

    write(f'{OUT}/logs/invoice-api.log', api)
    write(f'{OUT}/logs/postgres-primary.log', pg)
    write(f'{OUT}/logs/postgres-replica.log', rep)
    write(f'{OUT}/logs/render-worker.log', render)
    write(f'{OUT}/logs/billing-scheduler.log', sched)
    write(f'{OUT}/logs/flag-service.log', flags)
    with open(f'{OUT}/metrics/per-minute.csv', 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(['minute', 'invoice_create_requests', 'invoice_create_5xx', 'invoice_create_p99_ms', 'invoice_create_p50_ms', 'db_lock_waits', 'replica_replay_lag_s', 'render_errors'])
        w.writerows(rows)
    with open(f'{OUT}/config/tenants.csv', 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(['tenant', 'segment'])
        w.writerows(TENANTS)


if __name__ == '__main__':
    main()
