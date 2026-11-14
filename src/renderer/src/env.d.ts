/// <reference types="vite/client" />
import type { NoirCutApi } from '../../shared/types'

declare global {
  interface Window {
    noircut: NoirCutApi
  }
}
