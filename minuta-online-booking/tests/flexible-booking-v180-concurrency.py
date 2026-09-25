"""Run only against a disposable PostgreSQL 17 database with the v180 synthetic fixture."""
import json
import os
import subprocess
import sys
import time
import uuid

psql = os.environ.get('PRIMETIME_TEST_PSQL', 'psql')
database = os.environ.get('PRIMETIME_TEST_DATABASE', 'primetime_v180_concurrency')
host = os.environ.get('PRIMETIME_TEST_HOST', '127.0.0.1')
port = os.environ.get('PRIMETIME_TEST_PORT', '65439')
if host not in ('127.0.0.1', 'localhost') or not database.startswith('primetime_v180_'):
    raise SystemExit('Refusing to run outside a named local disposable database')

def command(sql):
    return [psql, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1',
            '-h', host, '-p', port, '-U', 'postgres', '-d', database, '-c', sql]

def request_sql(request_id, wait):
    return f"""begin;
select public.book_flexible_appointment_v180(
 '{request_id}'::uuid,'00000000-0000-4000-8000-000000000180'::uuid,current_date+1,
 '10:00'::time,'18:00'::time,'Synthetic concurrent client','+79990000188');
select pg_sleep({wait});
commit;"""

ids = [str(uuid.uuid4()), str(uuid.uuid4())]
same_id = os.environ.get('PRIMETIME_TEST_SAME_ID') == '1'
if same_id:
    ids[1] = ids[0]
first = subprocess.Popen(command(request_sql(ids[0], 1.5)), stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, text=True)
time.sleep(0.2)
second = subprocess.Popen(command(request_sql(ids[1], 0)), stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, text=True)
results = []
for process in (first, second):
    output, error = process.communicate(timeout=20)
    if process.returncode:
        raise RuntimeError(error or output)
    data = next((json.loads(line) for line in output.splitlines()
                 if line.strip().startswith('{')), None)
    if data is None:
        raise RuntimeError(f'No booking result: {output}')
    results.append(data)

times = {item.get('booking_time') for item in results}
expected_times = {'10:00:00'} if same_id else {'10:00:00', '11:00:00'}
if times != expected_times:
    raise AssertionError(f'Unexpected nearest starts: {times}')
if any(item.get('result_code') != 'ok' for item in results):
    raise AssertionError('Concurrent request did not complete')
expected_count = 1 if same_id else 2
if len({item.get('booking_id') for item in results}) != expected_count:
    raise AssertionError('Unexpected number of booking identities')

count = subprocess.run(command("select count(*) from public.bookings where request_id in ('"+
    ids[0]+"'::uuid,'"+ids[1]+"'::uuid)"), text=True, capture_output=True, check=True)
if count.stdout.strip() != str(expected_count):
    raise AssertionError(f'Unexpected persisted booking count: {count.stdout}')
print('PASS: concurrent replay made one booking at 10:00' if same_id else
      'PASS: two concurrent requests chose 10:00 and 11:00 with two distinct bookings')
