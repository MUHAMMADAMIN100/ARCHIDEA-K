import { Component, type ReactNode } from 'react';
import { reloadForFreshChunks, clearChunkReloadGuard } from '../lib/chunkReload';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
  isChunk: boolean;
}

const CHUNK_RE =
  /loading (css )?chunk|dynamically imported module|failed to fetch|importing a module/i;

/**
 * Ловит ошибки рендера и сбои подгрузки чанков (code-splitting).
 * При ошибке чанка (устаревшая версия после деплоя) — один раз
 * перезагружает страницу; иначе показывает экран с кнопкой «Обновить».
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, isChunk: false };

  static getDerivedStateFromError(error: Error): State {
    return { error, isChunk: CHUNK_RE.test(String(error?.message || error)) };
  }

  componentDidCatch(error: Error) {
    if (CHUNK_RE.test(String(error?.message || error))) {
      reloadForFreshChunks();
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="text-lg font-semibold text-navy-900">
            {this.state.isChunk
              ? 'Не удалось загрузить раздел'
              : 'Что-то пошло не так'}
          </div>
          <div className="max-w-xs text-sm text-navy-600">
            {this.state.isChunk
              ? 'Проверьте подключение к интернету и обновите страницу.'
              : 'Попробуйте обновить страницу. Если не помогло — сообщите нам.'}
          </div>
          <button
            onClick={() => {
              clearChunkReloadGuard();
              window.location.reload();
            }}
            className="btn-primary"
          >
            Обновить
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
