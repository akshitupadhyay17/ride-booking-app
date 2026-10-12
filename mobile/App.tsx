import React, { useEffect, useMemo } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiClient } from './src/model/api';
import { RealtimeClient } from './src/model/realtime';
import { AppPresenter } from './src/presenters/AppPresenter';
import { LoginView } from './src/views/LoginView';
import { MainView } from './src/views/MainView';
import { colors } from './src/views/theme';
import { usePresenterState } from './src/views/usePresenter';

export default function App() {
  // Composition root: wire Model services into the root Presenter.
  const app = useMemo(() => new AppPresenter({ api: new ApiClient(), realtime: new RealtimeClient() }), []);
  const s = usePresenterState(app);
  useEffect(() => { app.boot(); }, [app]);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {s.booting ? (
        <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.cyan} size="large" />
        </View>
      ) : s.user && app.container ? <MainView app={app} /> : <LoginView presenter={app} />}
    </SafeAreaProvider>
  );
}
