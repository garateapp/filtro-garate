import * as Haptics from 'expo-haptics';

export function notifyFeedback(direction: 'entrada' | 'salida') {
  void Haptics.notificationAsync(
    direction === 'entrada'
      ? Haptics.NotificationFeedbackType.Success
      : Haptics.NotificationFeedbackType.Warning
  ).catch(() => {});
}
