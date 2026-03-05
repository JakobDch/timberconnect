import { useState } from 'react';
import { motion } from 'framer-motion';
import { Maximize2, X, Download } from 'lucide-react';

interface ChartDisplayProps {
  imageBase64: string;
  chartType?: string;
  title?: string;
}

export function ChartDisplay({ imageBase64, chartType, title }: ChartDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = `data:image/png;base64,${imageBase64}`;
    link.download = `timberconnect-${chartType || 'chart'}-${Date.now()}.png`;
    link.click();
  };

  return (
    <>
      {/* Inline Chart */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative group bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm"
      >
        <img
          src={`data:image/png;base64,${imageBase64}`}
          alt={title || 'Visualisierung'}
          className="w-full h-auto cursor-pointer"
          onClick={() => setIsExpanded(true)}
        />
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => setIsExpanded(true)}
            className="p-1.5 bg-white/90 rounded-lg shadow-sm hover:bg-white transition-colors"
            title="Vergrößern"
          >
            <Maximize2 className="w-4 h-4 text-gray-600" />
          </button>
          <button
            onClick={handleDownload}
            className="p-1.5 bg-white/90 rounded-lg shadow-sm hover:bg-white transition-colors"
            title="Herunterladen"
          >
            <Download className="w-4 h-4 text-gray-600" />
          </button>
        </div>
      </motion.div>

      {/* Expanded Modal */}
      {isExpanded && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-4"
          onClick={() => setIsExpanded(false)}
        >
          <motion.div
            initial={{ scale: 0.9 }}
            animate={{ scale: 1 }}
            className="relative max-w-4xl max-h-[90vh] bg-white rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <h4 className="font-medium text-timber-dark">
                {title || 'Visualisierung'}
              </h4>
              <div className="flex gap-2">
                <button
                  onClick={handleDownload}
                  className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                  title="Herunterladen"
                >
                  <Download className="w-5 h-5 text-gray-600" />
                </button>
                <button
                  onClick={() => setIsExpanded(false)}
                  className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <X className="w-5 h-5 text-gray-600" />
                </button>
              </div>
            </div>
            <div className="p-4 overflow-auto max-h-[calc(90vh-60px)]">
              <img
                src={`data:image/png;base64,${imageBase64}`}
                alt={title || 'Visualisierung'}
                className="w-full h-auto"
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </>
  );
}
