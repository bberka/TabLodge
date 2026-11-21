#!/bin/sh
# Runs one scale scenario (scripts/perf/scenarios.ts) on an emulator, against a release build made with
# EXPO_PUBLIC_PERF=1 (see docs/agents/mobile.md#profiling-a-large-library). Usage:
#   run-matrix.sh <scenario> <adb serial> <agent-device command> <output dir>
# The sync server for the run listens on 18917 (the port the build was made for). The emulator needs `adb root`
# and a redirect of its localhost:18917 to the host, because `adb reverse` returned no data on some emulators:
#   adb -s <serial> root
#   adb -s <serial> shell 'sysctl -w net.ipv4.conf.all.route_localnet=1; iptables -t nat -A OUTPUT -p tcp -d 127.0.0.1 --dport 18917 -j DNAT --to-destination 10.0.2.2:18917; iptables -t nat -A POSTROUTING -p tcp -d 10.0.2.2 --dport 18917 -j MASQUERADE'
set -u
SCENARIO=$1 SERIAL=$2 AD=$3 OUT=$4
PKG=com.bberka.tablodge
TOKEN=perf-token-perf-token-perf-token-0123456789
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
mkdir -p "$OUT"
adb="adb -s $SERIAL"

wait_for() { # <pattern> <seconds>
	i=0
	while [ $i -lt "$2" ]; do
		$adb logcat -d -s ReactNativeJS | grep -q "$1" && return 0
		sleep 1
		i=$((i + 1))
	done
	return 1
}
perf_lines() { $adb logcat -d -s ReactNativeJS | grep PERF | sed 's/.*PERF //'; }
crashes() { $adb logcat -d | grep -E "FATAL EXCEPTION|ANR in com.bberka|Fatal signal|OutOfMemoryError|Process com.bberka.tablodge .*has died|lowmemorykiller.*tablodge" | head -5 | sed 's/^/CRASH /'; }

if [ "${LOCAL:-}" = 1 ]; then
	# LOCAL=1: no server. The library goes straight into the phone's storage (needs `adb root`), for a library too
	# large to sync in reasonable time. The in-app benchmarks skip the sync steps.
	for pid in $(ss -ltnp 2>/dev/null | grep ":18917 " | sed -n 's/.*pid=\([0-9]*\).*/\1/p'); do kill "$pid"; done
	(cd "$ROOT/apps/mobile" && TL_SCENARIO=$SCENARIO TL_DUMP="$OUT/$SCENARIO.library.json" pnpm exec vp test run tests/live/perf-seed.test.ts >/dev/null 2>&1)
	$adb shell am force-stop $PKG
	$adb shell pm clear $PKG >/dev/null
	$adb logcat -c
	$adb shell am start -W -n $PKG/.MainActivity >/dev/null
	wait_for 'library-ready' 60
	$adb shell am force-stop $PKG
	DB=/data/data/$PKG/files/SQLite/ExpoSQLiteStorage
	rm -f "$OUT/db" "$OUT/db-wal" "$OUT/db-shm"
	$adb pull $DB "$OUT/db" >/dev/null 2>&1
	sqlite3 "$OUT/db" "PRAGMA wal_checkpoint(TRUNCATE); INSERT OR REPLACE INTO storage(key, value) VALUES('tablodge.library', CAST(readfile('$OUT/$SCENARIO.library.json') AS TEXT)); INSERT OR REPLACE INTO storage(key, value) VALUES('tablodge.perf.local', 'true'); DELETE FROM storage WHERE key = 'tablodge.perf.done' OR key LIKE 'tablodge.sync.%';"
	$adb push "$OUT/db" $DB >/dev/null 2>&1
	$adb shell "chown \$(stat -c %u /data/data/$PKG) /data/data/$PKG/files/SQLite/ExpoSQLiteStorage; rm -f $DB-wal $DB-shm; restorecon $DB" >/dev/null 2>&1
	$adb logcat -c
	$adb shell am start -W -n $PKG/.MainActivity >/dev/null
	wait_for '"step":"done"\|perf-error' 900 || echo "TIMEOUT run A" >>"$OUT/$SCENARIO.A.log"
	perf_lines >>"$OUT/$SCENARIO.A.log"
	crashes >>"$OUT/$SCENARIO.A.log"
else
	# Fresh server holding the scenario.
	# Stop whatever listens on the port: a server left over from an earlier run would keep its old library.
	for pid in $(ss -ltnp 2>/dev/null | grep ":18917 " | sed -n 's/.*pid=\([0-9]*\).*/\1/p'); do kill "$pid"; done
	sleep 1
	DATA=$OUT/server-data-$SCENARIO
	rm -rf "$DATA"
	mkdir -p "$DATA"
	TABLODGE_SYNC_TOKEN=$TOKEN DATA_DIR=$DATA PORT=18917 node "$ROOT/apps/server/dist/node.js" >"$OUT/server-$SCENARIO.log" 2>&1 &
	echo $! >"$OUT/server.pid"
	sleep 2
	(cd "$ROOT/apps/mobile" && TL_SCENARIO=$SCENARIO TL_URL=http://localhost:18917 TL_TOKEN=$TOKEN pnpm exec vp test run tests/live/perf-seed.test.ts --reporter=verbose 2>&1 | grep -E "SEEDED|Error|FAIL" ) >"$OUT/$SCENARIO.seed.txt"

	# A: first start pulls the whole library, then the in-app benchmarks run.
	$adb shell am force-stop $PKG
	$adb shell pm clear $PKG >/dev/null
	$adb logcat -c
	$adb shell am start -W -n $PKG/.MainActivity >/dev/null
	wait_for '"step":"done"\|perf-error' 900 || echo "TIMEOUT run A" >>"$OUT/$SCENARIO.A.log"
	perf_lines >>"$OUT/$SCENARIO.A.log"
	crashes >>"$OUT/$SCENARIO.A.log"


fi

if [ "${ONLY_A:-}" = 1 ]; then
	$adb shell am force-stop $PKG
	exit 0
fi

# B: cold start on the saved library.
$adb shell am force-stop $PKG
sleep 2
$adb logcat -c
$adb shell am start -W -n $PKG/.MainActivity 2>&1 | grep -E "TotalTime|WaitTime" >"$OUT/$SCENARIO.B.log"
case $SCENARIO in
sessions-* | links-* | folders-*)
	# The Bookmarks screen opens first and is empty here; the sessions show once the tab is pressed.
	wait_for 'library-ready' 60
	sleep 3
	$AD press 436 2222 >/dev/null 2>&1
	wait_for 'sessions-first-rows' 120 || echo "no session rows in 120s" >>"$OUT/$SCENARIO.B.log"
	;;
*)
	wait_for 'bookmarks-first-rows' 60 || echo "no bookmark rows in 60s" >>"$OUT/$SCENARIO.B.log"
	;;
esac
perf_lines >>"$OUT/$SCENARIO.B.log"
crashes >>"$OUT/$SCENARIO.B.log"

# C: scroll, then D: search typing.
sleep 3
$adb shell dumpsys gfxinfo $PKG reset >/dev/null 2>&1
i=0
while [ $i -lt 8 ]; do
	$adb shell input swipe 540 1900 540 500 250
	sleep 1
	i=$((i + 1))
done
$adb shell dumpsys gfxinfo $PKG | grep -E "Total frames rendered|Janky frames|50th|90th|95th|99th|Number Missed|Number High" >"$OUT/$SCENARIO.C.txt"
$adb logcat -c
$AD press 954 2220 >/dev/null 2>&1
sleep 2
$AD type guide --delay-ms 700 >/dev/null 2>&1
sleep 4
perf_lines >"$OUT/$SCENARIO.D.log"
crashes >>"$OUT/$SCENARIO.D.log"
$adb shell am force-stop $PKG
