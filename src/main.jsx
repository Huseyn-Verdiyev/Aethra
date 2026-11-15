import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Telecommunications & Runtime Diagnostic Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F0F4F8] text-[#0A192F] flex items-center justify-center p-6 font-mono">
          <div className="bg-white border border-[#CBD5E1] rounded-2xl p-6 max-w-lg w-full space-y-3 shadow-xl">
            <div className="flex items-center gap-2 text-[#BE123C] font-semibold text-sm">
              <span>CRITICAL TELEMETRY EXCEPTION</span>
            </div>
            <p className="text-xs text-[#334E68] leading-relaxed">
              The mission browser encountered an unhandled exception:
            </p>
            <pre className="bg-[#FFF1F2] border border-[#FECDD3] p-3 rounded-xl text-[11px] text-[#9F1239] overflow-x-auto whitespace-pre-wrap">
              {this.state.error?.toString()}
            </pre>
            <button
              onClick={() => window.location.reload()}
              className="bg-[#0A192F] hover:bg-[#132C4E] text-white text-xs px-3.5 py-2 rounded-xl font-sans font-bold cursor-pointer shadow-sm"
            >
              Reload Mission Console
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
