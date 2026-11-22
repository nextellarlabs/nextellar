import React, { useState } from 'react';

interface Sep24FrameProps {
  anchorDomain: string;
  assetCode: string;
  kind: 'deposit' | 'withdraw';
  authToken: string;
  onClose: () => void;
  onSuccess?: () => void;
}

export const Sep24Frame: React.FC<Sep24FrameProps> = ({
  anchorDomain,
  assetCode,
  kind,
  authToken,
  onClose,
  onSuccess,
}) => {
  const [interactiveUrl, setInteractiveUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [frameError, setFrameError] = useState<string | null>(null);

  // Initialize SEP-24 session with anchor
  const handleInitiateSession = async () => {
    setLoading(true);
    setFrameError(null);

    try {
      const response = `https://${anchorDomain}/sep24/${kind}?asset_code=${assetCode}&jwt=${authToken}`;
      setInteractiveUrl(response);
    } catch (err: any) {
      setFrameError(err.message || 'Failed to initialize SEP-24 interactive window.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col h-[600px]">
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-gray-100 bg-gray-50">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 capitalize">
              {kind} {assetCode} via SEP-24
            </h3>
            <p className="text-xs text-gray-500">Anchor: {anchorDomain}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl font-bold px-2 py-1"
          >
            &times;
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 flex flex-col items-center justify-center p-6 relative">
          {!interactiveUrl ? (
            <div className="text-center space-y-4">
              <p className="text-sm text-gray-600">
                Click below to securely connect with the anchor interactive session.
              </p>
              <button
                onClick={handleInitiateSession}
                disabled={loading}
                className="px-6 py-2.5 bg-indigo-600 text-white font-medium rounded-lg shadow hover:bg-indigo-700 disabled:opacity-50"
              >
                {loading ? 'Connecting to Anchor...' : `Start ${kind} Flow`}
              </button>
            </div>
          ) : (
            <iframe
              src={interactiveUrl}
              title="SEP-24 Interactive Flow"
              className="w-full h-full border-0 rounded-b-xl"
              onLoad={() => {
                // Handle success listeners or postMessage events here
                if (onSuccess) onSuccess();
              }}
            />
          )}

          {frameError && (
            <div className="absolute bottom-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md">
              {frameError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
