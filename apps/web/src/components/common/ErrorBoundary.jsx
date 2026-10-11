import { Component } from "react";

// Catches a render crash inside one page so the sidebar/top bar stay usable.
// `resetKey` (the current URL) clears the error when the user navigates away.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Surface in the browser console for debugging; never sent anywhere.
    console.error("Page crashed:", error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="bg-white rounded-2xl border border-red-200 p-8 text-center">
        <h1 className="text-lg font-semibold text-slate-900 mb-1">This page ran into a problem</h1>
        <p className="text-sm text-slate-500 mb-4">The rest of the app still works. Try again, or go to another page.</p>
        <button type="button" onClick={() => this.setState({ error: null })} className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium">
          Try again
        </button>
      </div>
    );
  }
}
