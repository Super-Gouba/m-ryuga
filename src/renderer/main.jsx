import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import '@fontsource/chakra-petch/400.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles/tokens.css';
// 页面模块（side-effect：调用 registerPages 注入 App 壳）
import './pages/calls.jsx';
import './pages/compare.jsx';
import './pages/live.jsx';
import './pages/asr.jsx';
import './pages/settings.jsx';

createRoot(document.getElementById('root')).render(<App />);
