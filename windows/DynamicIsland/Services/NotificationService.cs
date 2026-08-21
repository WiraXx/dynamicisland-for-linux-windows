using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows.Media;
using System.Windows.Threading;
using Windows.UI.Notifications;
using Windows.UI.Notifications.Management;

namespace DynamicIsland.Services
{
    /// <summary>Une notification lue sur le système.</summary>
    public class NotificationItem
    {
        public uint Id;
        public string AppName = string.Empty;
        public string Title = string.Empty;
        public string Body = string.Empty;
        public DateTime Timestamp = DateTime.Now;
        public ImageSource Icon;
    }

    /// <summary>
    /// Notifications des autres applications, par UserNotificationListener.
    ///
    /// Windows réserve cette lecture aux applications empaquetées : pour un
    /// programme lancé depuis un simple .exe, l'autorisation est souvent
    /// refusée. On le détecte au démarrage et on le dit, plutôt que de rester
    /// silencieusement vide.
    /// </summary>
    public class NotificationService
    {
        private UserNotificationListener _listener;
        private DispatcherTimer _timer;
        private readonly HashSet<uint> _seen = new HashSet<uint>();
        private bool _busy;

        public event EventHandler<NotificationItem> Received;

        public bool Available { get; private set; }

        public string UnavailableReason { get; private set; } =
            "Autorisation Windows non accordée";

        public async void Start()
        {
            try
            {
                _listener = UserNotificationListener.Current;
                if (_listener == null)
                {
                    UnavailableReason = "Service de notifications indisponible";
                    return;
                }

                var access = await _listener.RequestAccessAsync();
                if (access != UserNotificationListenerAccessStatus.Allowed)
                {
                    UnavailableReason =
                        "Windows refuse l'accès aux notifications (Paramètres > " +
                        "Confidentialité > Notifications)";
                    return;
                }
            }
            catch (Exception)
            {
                UnavailableReason = "Lecture des notifications impossible sur cette machine";
                return;
            }

            Available = true;

            // Premier passage silencieux : on ne rejoue pas l'historique déjà
            // affiché par Windows avant notre démarrage.
            await ScanAsync(true);

            _timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
            _timer.Tick += async (s, e) => await ScanAsync(false);
            _timer.Start();
        }

        private async System.Threading.Tasks.Task ScanAsync(bool silent)
        {
            if (_busy || _listener == null)
                return;
            _busy = true;

            try
            {
                var notifications = await _listener.GetNotificationsAsync(NotificationKinds.Toast);
                var present = new HashSet<uint>();

                foreach (var notification in notifications)
                {
                    present.Add(notification.Id);
                    if (!_seen.Add(notification.Id) || silent)
                        continue;

                    var item = Convert(notification);
                    if (item != null)
                        Received?.Invoke(this, item);
                }

                // Les notifications fermées ailleurs peuvent revenir plus tard
                // avec un nouvel identifiant : on oublie celles qui ont disparu.
                _seen.RemoveWhere(id => !present.Contains(id));
            }
            catch (Exception)
            {
                // Une lecture ratée ne doit pas arrêter la surveillance.
            }
            finally
            {
                _busy = false;
            }
        }

        private NotificationItem Convert(UserNotification notification)
        {
            try
            {
                var binding = notification.Notification.Visual.GetBinding(
                    KnownNotificationBindings.ToastGeneric);
                if (binding == null)
                    return null;

                var texts = binding.GetTextElements();
                string title = texts.Count > 0 ? texts[0].Text : string.Empty;
                string body = texts.Count > 1
                    ? string.Join(" ", texts.Skip(1).Select(t => t.Text))
                    : string.Empty;

                string appName = string.Empty;
                try
                {
                    appName = notification.AppInfo?.DisplayInfo?.DisplayName ?? string.Empty;
                }
                catch (Exception)
                {
                    // Certaines applications système n'exposent pas leur nom.
                }

                if (string.IsNullOrWhiteSpace(title))
                    title = string.IsNullOrWhiteSpace(appName) ? "Notification" : appName;

                return new NotificationItem
                {
                    Id = notification.Id,
                    AppName = appName,
                    Title = title,
                    Body = body,
                    Timestamp = notification.CreationTime.LocalDateTime,
                };
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>Ferme la notification côté Windows.</summary>
        public void Dismiss(uint id)
        {
            try
            {
                _listener?.RemoveNotification(id);
            }
            catch (Exception)
            {
                // Déjà fermée par l'application elle-même.
            }
        }

        public void Stop()
        {
            if (_timer != null)
            {
                _timer.Stop();
                _timer = null;
            }
        }
    }
}
