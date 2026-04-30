'use client';

import * as Sentry from "@sentry/nextjs";
import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
  contractId?: string;
}

interface State {
  hasError: boolean;
  eventId?: string;
}

export class WarRoomErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    const eventId = Sentry.captureException(error, {
      contexts: {
        react: { componentStack: info.componentStack },
        warRoom: { contractId: this.props.contractId },
      },
    });
    this.setState({ eventId });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
          <p className="text-sm text-red-400">
            War Room mengalami error yang tidak terduga
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-200"
            >
              Muat Ulang
            </button>
            {this.state.eventId && (
              <button
                onClick={() => Sentry.showReportDialog({ eventId: this.state.eventId })}
                className="rounded-lg bg-red-500/20 px-4 py-2 text-sm text-red-400"
              >
                Laporkan Error
              </button>
            )}
          </div>
          <p className="text-xs text-zinc-600">Error ID: {this.state.eventId}</p>
        </div>
      );
    }

    return this.props.children;
  }
}
