export type MvpPlatform = 'macos' | 'windows' | 'linux' | 'unknown'

export type MvpStep =
  | 'welcome'
  | 'envCheck'
  | 'wslSetup'
  | 'install'
  | 'apiKeyGuide'
  | 'telegramGuide'
  | 'done'
  | 'troubleshoot'

export type MvpEventType =
  | 'step_view'
  | 'step_complete'
  | 'lead_submit'
  | 'install_start'
  | 'install_done'
  | 'error'

export interface MvpSessionRecord {
  sessionId: string
  platform: MvpPlatform
  appVersion: string
  createdAt: string
  updatedAt: string
  source?: string
}

export interface MvpEventRecord {
  id: string
  sessionId: string
  eventType: MvpEventType
  step?: MvpStep
  payload?: Record<string, unknown>
  createdAt: string
}

export interface CreateMvpSessionInput {
  sessionId: string
  platform?: MvpPlatform
  appVersion?: string
  source?: string
}

export interface CreateMvpEventInput {
  sessionId: string
  eventType: MvpEventType
  step?: MvpStep
  payload?: Record<string, unknown>
}
