import { SellerApplicationResponseDto } from "./seller-application-response.dto";

export interface ListSellerApplicationsResponseDto {
  items: SellerApplicationResponseDto[];
  meta: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}
