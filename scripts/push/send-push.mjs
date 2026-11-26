import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import webpush from 'web-push';

const TIME_ZONE = 'America/Sao_Paulo';

/**
 * Retorna a data e hora atual no fuso de Brasília (America/Sao_Paulo),
 * independente do fuso UTC do runner do GitHub Actions.
 */
const getBrasiliaDateParts = (now = new Date()) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(now).map((p) => [p.type, p.value])
  );
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour === '24' ? '0' : parts.hour);

  // Usa meio-dia local para evitar qualquer erro de virada de dia
  const today = new Date(year, month - 1, day, 12, 0, 0);
  const tomorrow = new Date(year, month - 1, day + 1, 12, 0, 0);
  const dayKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const slot = hour < 12 ? '08' : hour < 17 ? '12' : '17';

  return { today, tomorrow, dayKey, slot };
};

// --- Lógica de datas de Ensaios Locais (espelha utils/rehearsalDate.ts) ---
const isNthWeekdayOfMonth = (date, n, weekday) => {
  if (date.getDay() !== weekday) return false;
  const day = date.getDate();
  return day >= (n - 1) * 7 + 1 && day <= n * 7;
};

const isLastWeekdayOfMonth = (date, weekday) => {
  if (date.getDay() !== weekday) return false;
  const nextWeek = new Date(date.getTime() + 7 * 24 * 60 * 60 * 1000);
  return nextWeek.getMonth() !== date.getMonth();
};

const checkRehearsalForDate = (loc, date) => {
  const dayStr = String(loc.rehearsalDay || '').toLowerCase();
  const month = date.getMonth() + 1;
  const isEvenMonth = month % 2 === 0;
  const isOddMonth = month % 2 !== 0;

  if (dayStr.includes('mês par') && !isEvenMonth) return false;
  if (dayStr.includes('mês ímpar') && !isOddMonth) return false;

  const monthShorts = {
    jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
    jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
  };

  let hasMonthRestriction = false;
  let matchesMonthRestriction = false;
  for (const [short, mNum] of Object.entries(monthShorts)) {
    if (dayStr.includes(short)) {
      hasMonthRestriction = true;
      if (month === mNum) {
        matchesMonthRestriction = true;
        break;
      }
    }
  }
  if (hasMonthRestriction && !matchesMonthRestriction) return false;

  const weekdays = {
    'domingo': 0,
    'segunda-feira': 1,
    'terça-feira': 2,
    'quarta-feira': 3,
    'quinta-feira': 4,
    'sexta-feira': 5,
    'sábado': 6,
  };

  let targetWeekday = -1;
  for (const [name, val] of Object.entries(weekdays)) {
    if (dayStr.includes(name)) {
      targetWeekday = val;
      break;
    }
  }
  if (targetWeekday === -1) return false;

  if (dayStr.includes('1ª') || dayStr.includes('1º')) return isNthWeekdayOfMonth(date, 1, targetWeekday);
  if (dayStr.includes('2ª') || dayStr.includes('2º')) return isNthWeekdayOfMonth(date, 2, targetWeekday);
  if (dayStr.includes('3ª') || dayStr.includes('3º')) return isNthWeekdayOfMonth(date, 3, targetWeekday);
  if (dayStr.includes('4ª') || dayStr.includes('4º')) return isNthWeekdayOfMonth(date, 4, targetWeekday);
  if (dayStr.includes('última') || dayStr.includes('último') || dayStr.includes('ultimo')) {
    return isLastWeekdayOfMonth(date, targetWeekday);
  }

  return false;
};

// --- Lógica de datas de Eventos (Ensaios Regionais / Reuniões Musicais) ---
const parseEventDate = (dateStr) => {
  if (!dateStr) return null;
  const trimmed = String(dateStr).trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoMatch) {
    return { year: Number(isoMatch[1]), month: Number(isoMatch[2]), day: Number(isoMatch[3]) };
  }
  const brMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (brMatch) {
    return { year: Number(brMatch[3]), month: Number(brMatch[2]), day: Number(brMatch[1]) };
  }
  return null;
};

const isEventOnDate = (eventDate, target) => {
  const parsed = parseEventDate(eventDate);
  if (!parsed) return false;
  return (
    parsed.year === target.getFullYear() &&
    parsed.month === target.getMonth() + 1 &&
    parsed.day === target.getDate()
  );
};

async function main() {
  const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
  const vapidPublicKey = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const vapidPrivateKey = (process.env.VAPID_PRIVATE_KEY || '').trim();
  const vapidSubject = (process.env.VAPID_SUBJECT || 'mailto:notificacoes@calendario-musical.local').trim();

  if (!serviceAccountRaw || !vapidPublicKey || !vapidPrivateKey) {
    console.error(
      'Faltam variáveis de ambiente obrigatórias: FIREBASE_SERVICE_ACCOUNT, VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY.'
    );
    process.exit(1);
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountRaw);
  } catch (err) {
    console.error('FIREBASE_SERVICE_ACCOUNT não é um JSON válido.');
    process.exit(1);
  }

  initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore();
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const { today, tomorrow, dayKey, slot } = getBrasiliaDateParts();
  console.log(`Verificando eventos para ${dayKey} (faixa ${slot}h - Brasília)...`);

  const [
    adminsSnap,
    citiesSnap,
    locationsSnap,
    regionalSnap,
    meetingsSnap,
    visibilitySnap,
    subsSnap,
  ] = await Promise.all([
    db.collection('admins').get(),
    db.collection('cities').get(),
    db.collection('locations').get(),
    db.collection('regionalRehearsals').get(),
    db.collection('musicalMeetings').get(),
    db.collection('appSettings').doc('calendarVisibility').get(),
    db.collection('pushSubscriptions').get(),
  ]);

  const admins = adminsSnap.docs.map((d) => ({ ...d.data(), id: d.id }));
  const cities = citiesSnap.docs.map((d) => ({ ...d.data(), id: d.id }));
  const locations = locationsSnap.docs.map((d) => ({ ...d.data(), id: d.id }));
  const regionalRehearsals = regionalSnap.docs.map((d) => ({ ...d.data(), id: d.id }));
  const musicalMeetings = meetingsSnap.docs.map((d) => ({ ...d.data(), id: d.id }));
  const visibility = visibilitySnap.exists ? visibilitySnap.data() : {};

  const visibleAdminIds = new Set(admins.filter((a) => a.isHidden !== true).map((a) => a.id));
  const cityById = new Map();
  cities.forEach((c) => {
    if (visibleAdminIds.has(c.adminId)) cityById.set(c.id, c);
  });

  // Monta todos os lembretes ativos para Hoje e Amanhã
  const pendingAlerts = [];

  for (const loc of locations) {
    const city = cityById.get(loc.cityId);
    if (!city) continue;

    const isToday = checkRehearsalForDate(loc, today);
    const isTomorrow = !isToday && checkRehearsalForDate(loc, tomorrow);
    if (!isToday && !isTomorrow) continue;

    const whenLabel = isToday ? 'Hoje' : 'Amanhã';
    pendingAlerts.push({
      kind: 'local',
      adminId: city.adminId,
      payload: {
        title: `Ensaio ${whenLabel}`,
        body: `${loc.name} (${city.name}) às ${loc.rehearsalTime}`,
        locationId: loc.id,
        section: null,
        tag: `local-${loc.id}-${dayKey}-${slot}`,
      },
    });
  }

  const collectSectionEvents = (section, label, events, isHidden) => {
    if (isHidden) return;
    for (const ev of events) {
      const isToday = isEventOnDate(ev.date, today);
      const isTomorrow = !isToday && isEventOnDate(ev.date, tomorrow);
      if (!isToday && !isTomorrow) continue;

      const whenLabel = isToday ? 'Hoje' : 'Amanhã';
      const bodyParts = [`${ev.location} às ${ev.time}`];
      if (ev.description) bodyParts.push(ev.description);

      pendingAlerts.push({
        kind: section,
        payload: {
          title: `${label} (${whenLabel})`,
          body: bodyParts.join(' — '),
          locationId: null,
          section,
          tag: `event-${section}-${ev.id}-${dayKey}-${slot}`,
        },
      });
    }
  };

  collectSectionEvents('regional', 'Ensaio Regional', regionalRehearsals, !!visibility.regionalHidden);
  collectSectionEvents('meetings', 'Reunião Musical', musicalMeetings, !!visibility.meetingsHidden);

  console.log(`Lembretes encontrados (Hoje/Amanhã): ${pendingAlerts.length}`);
  console.log(`Aparelhos inscritos encontrados: ${subsSnap.size}`);

  if (pendingAlerts.length === 0 || subsSnap.empty) {
    console.log('Nada a enviar agora.');
    return;
  }

  let sentCount = 0;
  let skippedCount = 0;
  let removedCount = 0;
  let errorCount = 0;

  for (const subDoc of subsSnap.docs) {
    const data = subDoc.data();
    if (!data.endpoint || !data.keys?.p256dh || !data.keys?.auth) {
      skippedCount++;
      continue;
    }

    const mutedAdmins = new Set(Array.isArray(data.mutedAdminIds) ? data.mutedAdminIds : []);
    const mutedSections = new Set(Array.isArray(data.mutedEventSections) ? data.mutedEventSections : []);

    const notificationsForUser = pendingAlerts
      .filter((alert) => {
        if (alert.kind === 'local') return !mutedAdmins.has(alert.adminId);
        return !mutedSections.has(alert.kind);
      })
      .map((alert) => alert.payload);

    if (notificationsForUser.length === 0) {
      skippedCount++;
      continue;
    }

    const subscription = {
      endpoint: data.endpoint,
      keys: {
        p256dh: data.keys.p256dh,
        auth: data.keys.auth,
      },
    };

    try {
      await webpush.sendNotification(
        subscription,
        JSON.stringify({ notifications: notificationsForUser }),
        { TTL: 3600 }
      );
      sentCount++;
    } catch (err) {
      const statusCode = err?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await subDoc.ref.delete();
        removedCount++;
      } else {
        errorCount++;
        console.error(`Falha ao enviar para inscrição ${subDoc.id}: HTTP ${statusCode || 'desconhecido'}`);
      }
    }
  }

  console.log(
    `Resumo: enviados=${sentCount}, ignorados=${skippedCount}, expirados_removidos=${removedCount}, erros=${errorCount}`
  );
}

main().catch((err) => {
  console.error('Erro inesperado ao enviar notificações:', err);
  process.exit(1);
});
