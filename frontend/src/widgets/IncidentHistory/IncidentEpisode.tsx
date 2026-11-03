import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { episodeEventLabel, useEpisodeEvents } from '../../entities/incident/episode';
import { ApiError } from '../../shared/api/apiClient';
import { formatDateTime, formatUtc, viewerTimeZone } from '../../shared/lib/format';
import { ErrorState, Loading } from '../../shared/ui/bits';
import { CARD, FOCUS, LINK } from '../../shared/ui/styles';

// Screen 8.2: ordered text coordinates and Fleet map navigation, not a second unscoped map query.
export const IncidentEpisode: React.FC<{ incidentId: string; onLostAccess: () => void }> = ({
  incidentId,
  onLostAccess,
}) => {
  const { data, isLoading, error, refetch } = useEpisodeEvents(incidentId);
  const status = error instanceof ApiError ? error.statusCode : null;
  useEffect(() => {
    if (status === 404) onLostAccess();
  }, [status, onLostAccess]);
  if (status === 403 || status === 404) return null;
  return (
    <section className={CARD} aria-labelledby="episode-evidence">
      <h3 id="episode-evidence" className="mb-3 text-title-sm text-ink">
        Episode evidence
        {data && ` (${data.length} ${data.length === 1 ? 'event' : 'events'})`}
      </h3>
      {isLoading ? (
        <Loading label="Loading episode evidence…" />
      ) : error || !data ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : data.length === 0 ? (
        <p>No events recorded for this episode.</p>
      ) : (
        <ol
          tabIndex={0}
          aria-label="Episode events, oldest first"
          className={`flex max-h-96 flex-col gap-3 overflow-y-auto ${FOCUS}`}
        >
          {data.map((event) => (
            <li key={event.eventId} className="text-body text-ink">
              <p>{episodeEventLabel(event.kind)}</p>
              {event.observedAt === null ? (
                <p>Time unavailable</p>
              ) : (
                <time
                  dateTime={event.observedAt}
                  title={`${formatUtc(event.observedAt)}; ${viewerTimeZone()}`}
                >
                  {formatDateTime(event.observedAt)}
                </time>
              )}
              <p>
                {event.latitude === null || event.longitude === null
                  ? 'Position unavailable'
                  : `${event.latitude.toFixed(5)}, ${event.longitude.toFixed(5)}`}
              </p>
            </li>
          ))}
        </ol>
      )}
      <Link to="/t/map" className={`${LINK} mt-3 inline-block`}>
        Fleet map
      </Link>
    </section>
  );
};
