import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import './styles/main.css';
import './styles/workspace.css';
const mount=document.getElementById('root');
if(!mount)throw new Error('Missing React mount point #root');
createRoot(mount).render(<React.StrictMode><App/></React.StrictMode>);
void import('./engine/terrain-engine.js');
