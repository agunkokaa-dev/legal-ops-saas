# clause.id Incident Runbook

## Kontak
- Founder HP: TODO isi nomor yang bisa dihubungi jam 3 pagi
- VPS Provider support: TODO isi link support provider
- Supabase support: https://supabase.com/support

## Monitoring Links
- Status page: https://stats.uptimerobot.com/XXXXX
- Sentry: https://clause-id.sentry.io
- OpenAI usage: https://platform.openai.com/account/usage

---

## Skenario 1: Website Down (502 Bad Gateway)

```bash
ssh root@vmi3060924
cd /root/workspace-saas/backend
docker compose ps
docker compose logs api --tail 50
docker compose up -d
# Kalau masih gagal:
fuser -k 3000/tcp 8000/tcp
docker compose down
docker compose up -d
```

## Skenario 2: Pipeline AI Tidak Jalan

```bash
cd /root/workspace-saas/backend
docker compose logs worker --tail 50
docker compose restart worker
```

## Skenario 3: OpenAI Cost Spike

1. Cek https://platform.openai.com/account/usage.
2. Cek Sentry apakah ada error loop atau retry storm.
3. Cek `task_execution_logs` di Supabase untuk job berulang.
4. Jika spike masih berjalan, disable job worker sementara:

```bash
cd /root/workspace-saas/backend
docker compose stop worker
```

## Skenario 4: Database Timeout

1. Buka Supabase dashboard, lalu cek Database dan Query performance.
2. Cek apakah query lambat berasal dari endpoint review, negotiation, atau chat.
3. Restart Qdrant jika retrieval timeout:

```bash
cd /root/workspace-saas/backend
docker compose restart qdrant
```

## Template Komunikasi ke User

"Kami mendeteksi gangguan pada clause.id dan sedang dalam penanganan.
Estimasi recovery: X menit. Update di status.clause.id.
Mohon maaf atas ketidaknyamanan."

## Setup Checklist

- Sentry backend DSN: set `SENTRY_DSN_BACKEND` atau legacy `SENTRY_DSN` di env produksi.
- Sentry frontend DSN: set `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, dan `SENTRY_AUTH_TOKEN`.
- UptimeRobot monitors: `https://clause.id`, `https://clause.id/api/health`, `https://clause.id/api/v1/negotiation`.
- OpenAI alert: monthly budget $50 dan email threshold 80%.
