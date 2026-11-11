import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import {applyUiTheme,readUiTheme} from './ui-theme';
import './styles.css';
import './themes.css';
import './themes-neon.css';
import './themes-arcade.css';

applyUiTheme(readUiTheme());
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);