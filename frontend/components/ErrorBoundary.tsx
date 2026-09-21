import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Without this, any uncaught render/effect error anywhere below unmounts the
 * entire React tree (React 18 + createRoot) and leaves a blank white page -
 * the app had no recovery path at all. Keyed by pathname in App.tsx so
 * navigating away from the broken page mounts a fresh boundary automatically.
 */
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  // This project has no @types/react installed (React 19 ships no .d.ts of its
  // own either), so `React.Component` resolves as an untyped `any` base class
  // and its members aren't inherited by TS - `declare` re-asserts this one
  // explicitly so `this.props` below type-checks.
  declare props: ErrorBoundaryProps;
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Unhandled render error', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="container mx-auto flex min-h-[60vh] flex-col items-center justify-center px-6 py-24 text-center">
          <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-full bg-gray-50 text-3xl text-gray-300">
            <i className="fas fa-triangle-exclamation"></i>
          </div>
          <h1 className="mb-3 font-heading text-3xl font-semibold text-[#1D2B49]">Что-то пошло не так</h1>
          <p className="mx-auto mb-8 max-w-md text-gray-500">
            Страница не смогла загрузиться. Попробуйте обновить её или вернуться в каталог.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex rounded-full bg-[#1D2B49] px-8 py-3.5 font-heading font-semibold text-white transition-all hover:bg-[#152036]"
            >
              Обновить страницу
            </button>
            <a
              href="/"
              className="inline-flex rounded-full border border-gray-200 px-8 py-3.5 font-heading font-semibold text-[#1D2B49] transition-all hover:border-[#CEA549]"
            >
              На главную
            </a>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
