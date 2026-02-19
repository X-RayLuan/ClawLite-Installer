# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

EasyClaw는 OpenClaw AI 에이전트를 원클릭으로 설치하는 **Electron 데스크톱 인스톨러**. electron-vite + React + Tailwind CSS 4 기반이며 macOS/Windows를 지원한다.

## 주요 명령어

```bash
npm run dev          # 개발 모드 (electron-vite dev)
npm run build        # typecheck + electron-vite build
npm run lint         # eslint (캐시 사용)
npm run format       # prettier
npm run typecheck    # node + web 타입 체크

# 플랫폼별 빌드
npm run build:mac       # macOS (publish always)
npm run build:win       # Windows (publish always)
npm run build:mac-local # macOS (로컬 빌드만)
npm run build:win-local # Windows (로컬 빌드만)
```

## 아키텍처

### 3-layer 구조 (Electron 표준)

```
src/main/        → Main process (Node.js, 시스템 접근)
src/preload/     → Preload (contextBridge로 IPC API 노출)
src/renderer/    → Renderer process (React UI)
```

- **tsconfig.node.json**: main + preload 대상
- **tsconfig.web.json**: renderer 대상, `@renderer/*` path alias 사용

### Main process 서비스 (`src/main/services/`)

| 파일             | 역할                                                          |
| ---------------- | ------------------------------------------------------------- |
| `env-checker.ts` | Node.js/OpenClaw/WSL 설치 여부 및 버전 감지                   |
| `installer.ts`   | Node.js, WSL, OpenClaw 자동 설치 (플랫폼별 분기)              |
| `onboarder.ts`   | `openclaw onboard` CLI 실행 (API 키 설정, 텔레그램 채널 추가) |
| `gateway.ts`     | OpenClaw gateway(로컬 서버) start/stop/status 관리            |

### IPC 통신 패턴

1. `ipc-handlers.ts`에서 `ipcMain.handle()` 등록
2. `preload/index.ts`에서 `contextBridge.exposeInMainWorld('electronAPI', ...)` 로 renderer에 노출
3. renderer에서 `window.electronAPI.xxx()` 호출
4. 설치 진행 상황은 `install:progress` / `install:error` 이벤트로 main→renderer 단방향 전송

### Renderer 위자드 플로우

`useWizard` 훅이 스텝 네비게이션을 관리. 순서:

`welcome` → `envCheck` → (`install`) → `apiKeyGuide` → `telegramGuide` → `config` → `done`

- `install` 스텝은 환경 체크 결과에 따라 조건부 진입
- `goTo()`로 스텝 건너뛰기 가능, `history` ref로 뒤로가기 지원

### Windows 지원 방식

Windows에서는 WSL을 통해 Node.js/OpenClaw를 실행. `env-checker`, `installer`, `onboarder`, `gateway` 모두 `platform() === 'win32'`일 때 `wsl --` 프리픽스를 붙이는 패턴 사용.

## 코드 스타일

- Prettier: 싱글쿼트, 세미콜론 없음, 100자 폭, trailing comma 없음
- ESLint: `@electron-toolkit/eslint-config-ts` + React hooks/refresh 규칙
- 들여쓰기: 스페이스 2칸, LF 줄바꿈
