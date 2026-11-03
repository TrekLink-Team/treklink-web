import { Truncated } from '@treklink/ui';

export const LongText = () => (
  <div className="flex w-64 flex-col gap-2 rounded-card border border-line bg-surface p-3 text-body text-ink">
    <Truncated text="Group 14: Fansipan summit via Trạm Tôn, two nights at the 2,800 m camp" />
    <Truncated text="Short note" />
  </div>
);

export const InTableCell = () => (
  <table style={{ width: 320, tableLayout: 'fixed' }} className="border border-line bg-surface text-body text-ink">
    <tbody>
      <tr>
        <td style={{ width: 96 }} className="border-b border-line px-3 py-2 font-mono">CT-0142</td>
        <td className="border-b border-line px-3 py-2">
          <Truncated text="Nguyễn Minh Anh, Trần Thu Hà and four more trekkers from Hà Nội" />
        </td>
      </tr>
    </tbody>
  </table>
);
