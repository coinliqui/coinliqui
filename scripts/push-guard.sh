#!/bin/sh
#
# WHAT LEAVES THIS MACHINE. Run by .githooks/pre-push before the gate, on exactly the
# commits being pushed (the hook's stdin: "<local ref> <local sha> <remote ref> <remote sha>").
#
# The repository is public and crawled, so the cost of a mistake is not symmetric: a red
# push costs a minute, a pushed secret or a personal address is out for good — rewriting
# history does not take it back from the mirrors. Three refusals:
#
#   1. a secret, by gitleaks, in the commits being pushed (reviewed false positives are
#      listed by fingerprint in .gitleaksignore)
#   2. an author or committer that is not @coinliqui.com — 742b785 and 476ab3b went out under a
#      <user>@<hostname>.local address after the move to a new Mac, because the identity was
#      a machine default nobody had set
#   3. an added line carrying a personal-mailbox address (icloud, gmail, ...)
#
# No gitleaks installed means STOP, not skip: a guard that quietly does nothing on a new
# machine is the failure this file exists to prevent.
#
# Usage: scripts/push-guard.sh < pre-push-stdin     (exit 0 = clear, 1 = refused)

ZERO=0000000000000000000000000000000000000000
fail=0
say() { printf '  push guard: %s\n' "$*"; }

if ! command -v gitleaks >/dev/null 2>&1; then
  say "STOP — gitleaks is not installed (brew install gitleaks)"
  exit 1
fi

while read -r local_ref local_sha remote_ref remote_sha; do
  [ -z "$local_sha" ] && continue
  [ "$local_sha" = "$ZERO" ] && continue            # deleting a remote ref sends nothing
  if [ "$remote_sha" = "$ZERO" ]; then
    range="$local_sha --not --remotes"               # a new ref: everything not already out
  else
    range="$remote_sha..$local_sha"
  fi
  # shellcheck disable=SC2086
  count=$(git rev-list $range | wc -l | tr -d ' ')
  [ "$count" = 0 ] && continue

  if ! gitleaks git --no-banner --log-opts="$range" . >/dev/null 2>&1; then
    say "STOP — gitleaks found a secret in $local_ref ($count commit(s)):"
    gitleaks git --no-banner --redact --log-opts="$range" . 2>&1 | grep -E 'RuleID|File|Line|Commit' | sed 's/^/      /'
    fail=1
  fi

  # shellcheck disable=SC2086
  bad_ids=$(git log --format='%h %ae %ce' $range | awk '$2 !~ /@coinliqui\.com$/ || $3 !~ /@coinliqui\.com$/')
  if [ -n "$bad_ids" ]; then
    say "STOP — commits not authored as @coinliqui.com:"
    printf '%s\n' "$bad_ids" | sed 's/^/      /'
    fail=1
  fi

  # shellcheck disable=SC2086
  mailboxes=$(git log -p --format='commit %h' $range \
    | grep -E '^(commit |\+[^+])' \
    | grep -E -i -B0 '^commit |[A-Za-z0-9._%+-]+@(icloud|me|mac|gmail|googlemail|yahoo|outlook|hotmail|live|proton|protonmail|pm|yandex|mail|ya)\.(com|ru|me|net)' \
    | awk '/^commit /{c=$2; next} {print c ": " substr($0, 1, 120)}')
  if [ -n "$mailboxes" ]; then
    say "STOP — an added line carries a personal-mailbox address:"
    printf '%s\n' "$mailboxes" | sed 's/^/      /'
    fail=1
  fi
done

[ "$fail" = 0 ] && say "clear — no secret, identity @coinliqui.com, no personal mailbox"
exit "$fail"
