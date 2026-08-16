# 출시 체크리스트

## 배포
1. `nvm use 20`
2. `npm test` — 전부 PASS
3. `fly launch --no-deploy`
4. `fly volumes create game_data --size 1`
5. `fly deploy`
6. `curl https://<앱>.fly.dev/health` → `{"ok":true,...}`
7. `npm run smoke` (BASE를 배포 주소로)

## 첫 플레이 확인 (본인, 30분)
- [ ] 시작 화면에서 닉네임 입력 → 캐릭터 생성됨
- [ ] Market 탭에 가격과 원인(▲/▼ + 요인 이름)이 보임
- [ ] 매수 → 보유 수량 증가
- [ ] 손절(stop) 주문이 걸림 / 취소됨
- [ ] News 탭에 뉴스가 흐름
- [ ] Survival 탭에서 먹기·쉬기로 체력 회복
- [ ] 굶어 죽으면 결과 화면 → 새 캐릭터 시작됨
- [ ] Ranking에 내 등수가 보임
- [ ] 다른 브라우저(시크릿)에서 내 characterId로 매매 시도 → 실패

## 공개 전
- [ ] 백업 1회 받아봄 (DEPLOY.md)
- [ ] 지인 3~5명 테스트
- [ ] 밸런스는 config/*.json 만 수정
