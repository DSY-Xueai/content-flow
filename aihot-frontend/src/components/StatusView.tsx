interface StatusViewProps {
  title: string;
  detail?: string;
}

export function StatusView({ title, detail }: StatusViewProps) {
  return (
    <div className="status-view" role="status">
      <h2>{title}</h2>
      {detail ? <p>{detail}</p> : null}
    </div>
  );
}
