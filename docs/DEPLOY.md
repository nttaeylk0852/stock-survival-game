# 배포 (Fly.io)

```bash
fly launch --no-deploy
fly volumes create game_data --size 1
fly deploy
fly logs
```

- 롤백: `fly releases`로 이전 버전을 확인한 뒤 `fly deploy --image <이전 이미지 태그>`.
- DB 백업: `fly ssh sftp get /data/game.db ./game.db.backup`.
