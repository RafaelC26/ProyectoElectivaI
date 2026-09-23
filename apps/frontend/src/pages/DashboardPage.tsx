import { FlowChart } from '../charts/FlowChart';
import { OccupancyChart } from '../charts/OccupancyChart';
import { RankingChart } from '../charts/RankingChart';
import { AlertModal, AlertsPanel } from '../components/AlertsPanel';
import { EventFeed } from '../components/EventFeed';
import { KpiCards } from '../components/KpiCards';
import { ParkingMap } from '../components/ParkingMap';
import { PipelinePanel } from '../components/PipelinePanel';
import { ZoneDrawer } from '../components/ZoneDrawer';

/** Dashboard principal: todo el sistema en una sola vista. */
export function DashboardPage() {
  return (
    <div className="flex flex-col gap-4">
      <KpiCards />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <ParkingMap />
        <div className="flex flex-col gap-4 xl:max-h-[calc(100vh-120px)] xl:min-h-[720px]">
          <AlertsPanel className="max-h-[360px] min-h-[220px]" />
          <EventFeed className="min-h-[420px] flex-1" />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <OccupancyChart />
        <FlowChart />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <RankingChart />
        <PipelinePanel />
      </div>

      <ZoneDrawer />
      <AlertModal />
    </div>
  );
}
