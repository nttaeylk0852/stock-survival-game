# 배포 (Fly.io)

```bash
fly launch --no-deploy
fly volumes create game_data --size 1
fly deploy
fly logs
```

- 롤백: `fly releases`로 이전 버전을 확인한 뒤 `fly deploy --image <이전 이미지 태그>`.
- DB 백업: `fly ssh sftp get /data/game.db ./game.db.backup`.
- 정기 백업: 로컬에서 하루 1회 `fly ssh sftp get /data/game.db ./backups/game-$(date +%F).db`.
- 배포 직후 확인: `curl https://<앱>.fly.dev/health` → `{"ok":true,...}`, 그 다음 `npm run smoke`.
