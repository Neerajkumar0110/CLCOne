import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Pagination, Select, Space } from 'antd';
import { SearchOutlined } from '@ant-design/icons';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export function useLearnerList(rows, { getSearchText, getFilterValue, pageSize: initialPageSize = 10 } = {}) {
  const [search, setSearchState] = useState('');
  const [filter, setFilterState] = useState('all');
  const [page, setPageState] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    const source = Array.isArray(rows) ? rows : [];
    return source.filter((row) => {
      const searchText = getSearchText ? getSearchText(row) : '';
      if (needle && !String(searchText ?? '').toLocaleLowerCase().includes(needle)) return false;
      if (filter !== 'all' && getFilterValue && String(getFilterValue(row)) !== filter) return false;
      return true;
    });
  }, [rows, search, filter, getSearchText, getFilterValue]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.max(1, Math.min(page, pageCount));

  useEffect(() => {
    if (page !== currentPage) setPageState(currentPage);
  }, [page, currentPage]);

  return {
    search,
    setSearch: (value) => { setSearchState(value); setPageState(1); },
    filter,
    setFilter: (value) => { setFilterState(value || 'all'); setPageState(1); },
    page: currentPage,
    setPage: (value) => setPageState((current) => Math.max(1, typeof value === 'function' ? value(current) : Number(value) || 1)),
    pageSize,
    setPageSize: (value) => {
      const nextSize = Number(value);
      if (Number.isFinite(nextSize) && nextSize > 0) setPageSizeState(Math.floor(nextSize));
      setPageState(1);
    },
    filteredRows,
    pageRows: filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    total: filteredRows.length,
    pageCount,
  };
}

export function LearnerListControls({
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  filter,
  onFilterChange,
  filterOptions = [],
  filterPlaceholder = 'All',
  extraControls,
  hasExtraFilter = false,
  onClearFilters,
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '12px 0' }}>
      <Space wrap>
        {onSearchChange && (
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder={searchPlaceholder}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            style={{ width: 260, maxWidth: '100%' }}
          />
        )}
        {onFilterChange && filterOptions.length > 0 && (
          <Select
            value={filter || 'all'}
            onChange={onFilterChange}
            style={{ minWidth: 150 }}
            options={[{ value: 'all', label: filterPlaceholder }, ...filterOptions]}
          />
        )}
        {extraControls}
        {((search && search.trim()) || (filter && filter !== 'all') || hasExtraFilter) && (
          <Button
            type="link"
            onClick={() => {
              if (onClearFilters) onClearFilters();
              else {
                if (onSearchChange) onSearchChange('');
                if (onFilterChange) onFilterChange('all');
              }
            }}
          >
            Clear filters
          </Button>
        )}
      </Space>
      {page != null && pageSize != null && onPageChange && onPageSizeChange && total > 0 && (
        <Pagination
          current={page}
          pageSize={pageSize}
          total={total}
          showSizeChanger
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          showTotal={(count, range) => `${range[0]}–${range[1]} of ${count}`}
          onChange={(nextPage, nextPageSize) => {
            if (nextPageSize !== pageSize) onPageSizeChange(nextPageSize);
            else onPageChange(nextPage);
          }}
          size="small"
          responsive
        />
      )}
    </div>
  );
}
