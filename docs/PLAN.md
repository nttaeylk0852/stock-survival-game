# Plan
다음 구현해야할 묶음: 20

## 묶음 20 — 런타임 고정과 테스트 복구

### 목표
`npm test`가 **끝까지** 돌아 전 스위트가 PASS로 보이게 한다.
지금은 stop-loss 스위트 직후 네이티브 크래시(code 134)로 죽고,
jobs / ranking / time / institution / death / season 테스트가 아예 실행되지 않는다.

### 증상 (그대로 옮김)
```
PASS  failed stop-loss stays open
#  node.exe: Assertion failed: (env) != nullptr  at src/api/hooks.cc:142
#  Statement::`scalar deleting destructor'
npm error code 134
```
원인: 로컬 Node가 v24. `better-sqlite3@11`은 Node 20/22 대상이다.
GC가 prepared statement를 정리할 때 이미 사라진 env의 cleanup hook을 건드려 죽는다.

### 하지 말 것
- `better-sqlite3` 버전 올리기. (Alpine 재컴파일 리스크. 지금 건드리지 마라)
- 테스트 케이스 삭제·skip으로 크래시를 숨기기.
- 게임 규칙·config 수치 변경.
- PostgreSQL 전환.

### 1. `.nvmrc` (저장소 루트, 신규)
```
20
```

### 2. `package.json` (루트)
`"scripts"` 옆에 추가:
```json
"engines": { "node": ">=20 <21" }
```

### 3. `packages/server/src/db/index.ts`
파일 끝에 추가 (기존 export 아래):
```ts
/** 테스트·종료 시 statement finalize를 GC에 맡기지 않고 명시적으로 닫는다. */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
```

### 4. `packages/server/src/test/run-tests.ts`
- 상단 import에 `closeDb`를 추가한다. (`from '../db'` — 이미 db에서 뭔가 import 중이면 거기 합친다)
- `main()` 마지막의
  ```ts
  process.exit(summarize());
  ```
  를 아래로 바꾼다:
  ```ts
  const code = summarize();
  closeDb();
  process.exitCode = code;
  ```
- 파일 맨 아래 `main().catch(...)` 안의 `process.exit(1)`은
  ```ts
  closeDb();
  process.exitCode = 1;
  ```
  로 바꾼다.

`process.exit()`를 즉시 호출하면 열린 statement가 강제 정리되며 크래시한다.
`exitCode`만 세팅하면 이벤트 루프가 정상 종료된다.

### 5. `packages/server/src/index.ts`
`shutdown()` 안 `server.close(() => process.exit(0));` 를:
```ts
server.close(() => {
  closeDb();
  process.exit(0);
});
```
`closeDb`를 `./db` import에 추가한다.

### 6. 임시 파일 정리
저장소 루트에서 아래 파일이 있으면 지운다:
`test-out.txt`, `test-out2.txt`, `weblist.txt`, `weblines.txt`, `nodever.txt`, `gitlog.txt`, `gitstatus.txt`

`.gitignore`에 아래 줄이 없으면 추가:
```
data/
*.db
*.db-wal
*.db-shm
test-out*.txt
```

### 검증
- [ ] Node 20에서 `npm test` 실행
- [ ] 출력 끝에 `Statement::` / `Assertion failed` / `code 134`가 **없다**
- [ ] 아래 이름이 PASS로 보인다 (하나라도 안 보이면 실패):
      job / ranking / market open / institution / death / season
- [ ] 실패한 테스트가 있으면 그 테스트만 고친다. 게임 규칙은 바꾸지 마라.

### 만약 Node가 20이 아니라면
`node -v`가 v20이 아니면 **코드를 더 고치지 말고** 이렇게만 답하고 멈춰라:
"Node 20이 필요합니다. nvm-windows로 `nvm install 20` → `nvm use 20` 후 다시 시켜주세요."

### 완료 후
PROGRESS 묶음 20 체크. 다음 작업 = 묶음 21. PLAN을 묶음 21로. **멈춤.**

